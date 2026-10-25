//! The measurement the overlay hands over (`submit_result`): numbers and enums only, so the
//! HUD writes the text itself in its own language and no free text travels between windows.
//! Kept in memory only (US-10), never written to disk.

use serde::{Deserialize, Serialize};

use crate::preset::Preset;

/// 64 points at most (`MAX_POINTS` in the UI).
pub const MAX_SEGMENTS: usize = 63;
const MAX_ROUTE_M: f64 = 200_000.0;
const MAX_DH_M: f64 = 999.0;
const MAX_TRAVEL_S: f64 = 1.0e7;
const MORTAR_MIN_M: f64 = 121.0;
const MORTAR_MAX_M: f64 = 700.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeasurementResult {
    pub preset: Preset,
    pub total_m: f64,
    pub error_m: f64,
    pub segments_m: Vec<f64>,
    pub dh_m: f64,
    pub mortar: Mortar,
    pub travel: Travel,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mortar {
    pub status: MortarStatus,
    pub sight_m: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MortarStatus {
    Ok,
    TooClose,
    TooFar,
    NoSolution,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Travel {
    pub sprint_s: f64,
    pub dacia_s: f64,
    pub dacia_verified: bool,
}

fn within(value: f64, max: f64) -> bool {
    value.is_finite() && (0.0..=max).contains(&value)
}

impl MeasurementResult {
    /// Finite numbers in range, segments that add up to the total, a consistent mortar answer.
    pub fn is_valid(&self) -> bool {
        let segments = self.segments_m.len();
        let sum: f64 = self.segments_m.iter().sum();
        (1..=MAX_SEGMENTS).contains(&segments)
            && self.segments_m.iter().all(|&m| within(m, MAX_ROUTE_M))
            && within(self.total_m, MAX_ROUTE_M)
            && (sum - self.total_m).abs() <= 1.0
            && within(self.error_m, MAX_ROUTE_M)
            && self.dh_m.is_finite()
            && self.dh_m.abs() <= MAX_DH_M
            && self.mortar.is_valid(segments)
            && within(self.travel.sprint_s, MAX_TRAVEL_S)
            && within(self.travel.dacia_s, MAX_TRAVEL_S)
    }
}

impl Mortar {
    /// A sight value only with "ok", and the mortar applies to exactly two points.
    fn is_valid(&self, segments: usize) -> bool {
        match (self.status, self.sight_m) {
            (MortarStatus::Ok, Some(sight)) => {
                segments == 1 && sight.is_finite() && (MORTAR_MIN_M..=MORTAR_MAX_M).contains(&sight)
            }
            (MortarStatus::NotApplicable, None) => segments > 1,
            (MortarStatus::TooClose | MortarStatus::TooFar | MortarStatus::NoSolution, None) => segments == 1,
            _ => false,
        }
    }
}

#[cfg(test)]
pub(crate) fn sample() -> MeasurementResult {
    MeasurementResult {
        preset: Preset::Near,
        total_m: 412.0,
        error_m: 2.2,
        segments_m: vec![412.0],
        dh_m: 35.0,
        mortar: Mortar { status: MortarStatus::Ok, sight_m: Some(424.1) },
        travel: Travel { sprint_s: 65.4, dacia_s: 14.8, dacia_verified: false },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_normal_result_is_valid() {
        assert!(sample().is_valid());
    }

    #[test]
    fn rejects_inconsistent_or_out_of_range_numbers() {
        let cases: Vec<fn(&mut MeasurementResult)> = vec![
            |r| r.total_m = 999.0,
            |r| r.total_m = f64::NAN,
            |r| r.segments_m.clear(),
            |r| r.segments_m = vec![1.0; MAX_SEGMENTS + 1],
            |r| r.error_m = -1.0,
            |r| r.dh_m = 5000.0,
            |r| r.mortar.sight_m = Some(800.0),
            |r| r.mortar.sight_m = None,
            |r| r.mortar = Mortar { status: MortarStatus::TooFar, sight_m: Some(500.0) },
            |r| r.mortar = Mortar { status: MortarStatus::NotApplicable, sight_m: None },
            |r| r.travel.dacia_s = f64::INFINITY,
        ];
        for (i, break_it) in cases.into_iter().enumerate() {
            let mut result = sample();
            break_it(&mut result);
            assert!(!result.is_valid(), "case {i}");
        }
    }

    #[test]
    fn a_route_has_no_mortar_value() {
        let mut route = sample();
        route.segments_m = vec![200.0, 212.0];
        route.mortar = Mortar { status: MortarStatus::NotApplicable, sight_m: None };
        assert!(route.is_valid());
    }

    #[test]
    fn unknown_fields_are_refused() {
        let mut json = serde_json::to_value(sample()).unwrap();
        json["html"] = serde_json::json!("<b>x</b>");
        assert!(serde_json::from_value::<MeasurementResult>(json).is_err());
    }
}

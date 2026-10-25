//! Commands of the overlay window: finish an exit, confirm a blank frame, save a scale, hand
//! over the result. `seq` ties each call to the session it belongs to.

use serde::Deserialize;
use tauri::{AppHandle, WebviewWindow};

use super::{expect_window, ErrorCode, IpcError};
use crate::app::overlay::result::MeasurementResult;
use crate::app::overlay::{self, GridInput, OverlayError};
use crate::app::windows::OVERLAY;
use crate::config::validate::{MAX_CELL_PX, MIN_CELL_PX};
use crate::config::{Point, StoreError};
use crate::logging;
use crate::preset::Preset;

/// Why the UI leaves; logged only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExitReason {
    Esc,
    Hotkey,
    NoCalibration,
    /// The other zoom's hotkey: the route is parked for it.
    SwitchZoom,
}

/// The part of a scale the UI decides (monitor, size and scale come from the session).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalibrationArgs {
    pub cell_meters: u32,
    pub cell_px: f64,
    pub origin: PointArgs,
}

/// `config::Point` accepts extra fields (it reads files); arguments do not.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PointArgs {
    pub x: f64,
    pub y: f64,
}

/// Grid origins far outside the screen are no use and hint at a broken caller.
const MAX_ORIGIN_PX: f64 = 100_000.0;

impl CalibrationArgs {
    fn validate(self) -> Result<GridInput, IpcError> {
        let finite_within = |v: f64, limit: f64| v.is_finite() && v.abs() <= limit;
        let valid = matches!(self.cell_meters, 100 | 1000)
            && self.cell_px.is_finite()
            && (MIN_CELL_PX..=MAX_CELL_PX).contains(&self.cell_px)
            && finite_within(self.origin.x, MAX_ORIGIN_PX)
            && finite_within(self.origin.y, MAX_ORIGIN_PX);
        if valid {
            let origin = Point { x: self.origin.x, y: self.origin.y };
            Ok(GridInput { cell_meters: self.cell_meters, cell_px: self.cell_px, origin })
        } else {
            Err(IpcError::new(ErrorCode::InvalidInput))
        }
    }
}

impl From<OverlayError> for IpcError {
    fn from(err: OverlayError) -> Self {
        match err {
            OverlayError::Stale => IpcError::new(ErrorCode::StaleSession),
            OverlayError::Invalid => IpcError::new(ErrorCode::InvalidInput),
            OverlayError::Store(StoreError::ReadOnly) => IpcError::new(ErrorCode::ReadOnly),
            OverlayError::Store(StoreError::Io(io)) => {
                logging::error("config", format!("saving a scale failed: {io}"));
                IpcError::new(ErrorCode::Io)
            }
        }
    }
}

#[tauri::command]
pub fn overlay_exit(window: WebviewWindow, app: AppHandle, seq: u64, reason: ExitReason) -> Result<(), IpcError> {
    expect_window(&window, &[OVERLAY])?;
    logging::info("overlay", format!("#{seq}: exit ({reason:?}), keys released"));
    Ok(overlay::exit(&app, seq, reason == ExitReason::SwitchZoom)?)
}

#[tauri::command]
pub fn overlay_blank(window: WebviewWindow, app: AppHandle, seq: u64) -> Result<(), IpcError> {
    expect_window(&window, &[OVERLAY])?;
    Ok(overlay::blanked(&app, seq)?)
}

#[tauri::command]
pub fn save_calibration(
    window: WebviewWindow,
    app: AppHandle,
    seq: u64,
    preset: Preset,
    calibration: CalibrationArgs,
) -> Result<(), IpcError> {
    expect_window(&window, &[OVERLAY])?;
    let grid = calibration.validate()?;
    Ok(overlay::save_calibration(&app, seq, preset, grid)?)
}

#[tauri::command]
pub fn submit_result(
    window: WebviewWindow,
    app: AppHandle,
    seq: u64,
    result: MeasurementResult,
) -> Result<(), IpcError> {
    expect_window(&window, &[OVERLAY])?;
    if !result.is_valid() {
        return Err(IpcError::new(ErrorCode::InvalidInput));
    }
    Ok(overlay::submit_result(&app, seq, result)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(cell_meters: u32, cell_px: f64, x: f64) -> CalibrationArgs {
        CalibrationArgs { cell_meters, cell_px, origin: PointArgs { x, y: 10.0 } }
    }

    #[test]
    fn accepts_a_normal_scale() {
        assert!(args(100, 170.4, 512.0).validate().is_ok());
        assert!(args(1000, 6.0, -50.0).validate().is_ok());
    }

    #[test]
    fn rejects_scales_out_of_range() {
        for bad in [
            args(500, 170.0, 0.0),
            args(100, 5.9, 0.0),
            args(100, 8000.5, 0.0),
            args(100, f64::NAN, 0.0),
            args(100, 170.0, 1e9),
        ] {
            assert_eq!(bad.validate().unwrap_err().code, ErrorCode::InvalidInput);
        }
    }

    #[test]
    fn the_overlays_own_arguments_parse() {
        // The same JSON the TypeScript side sends (tests/ipc-fixtures, written by hand).
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/ipc-fixtures");
        let calibration: CalibrationArgs =
            serde_json::from_str(&std::fs::read_to_string(dir.join("save_calibration.args.json")).unwrap()).unwrap();
        assert!(calibration.validate().is_ok());
        let result: MeasurementResult =
            serde_json::from_str(&std::fs::read_to_string(dir.join("submit_result.args.json")).unwrap()).unwrap();
        assert!(result.is_valid());
        let reason: ExitReason = serde_json::from_str("\"noCalibration\"").unwrap();
        assert_eq!(reason, ExitReason::NoCalibration);
    }

    #[test]
    fn unknown_fields_are_refused() {
        let json = r#"{"cellMeters":100,"cellPx":170,"origin":{"x":1,"y":2},"w":5}"#;
        assert!(serde_json::from_str::<CalibrationArgs>(json).is_err());
        let json = r#"{"cellMeters":100,"cellPx":170,"origin":{"x":1,"y":2,"z":3}}"#;
        assert!(serde_json::from_str::<CalibrationArgs>(json).is_err(), "nested too");
    }
}

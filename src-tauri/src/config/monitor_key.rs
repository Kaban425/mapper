//! Calibration key of a monitor: `"{width}x{height}@{scale %}"`, e.g. `2560x1440@125`.
//! Identical monitors at the same Windows scale show the map at the same size, so the
//! position does not matter and a scale comes back when the resolution is restored.

use std::fmt;
use std::ops::RangeInclusive;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// 3 to 5 digits, as `parse` accepts.
const SIDE: RangeInclusive<u32> = 100..=99_999;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct MonitorKey {
    width: u32,
    height: u32,
    percent: u32,
}

impl MonitorKey {
    /// From the monitor's physical size and scale factor (1.25 → 125 %). None for a size the
    /// key cannot spell (`parse` would refuse it, and the file could not be read back).
    pub fn new(width: u32, height: u32, scale: f64) -> Option<Self> {
        let percent = (scale * 100.0).round().clamp(10.0, 999.0) as u32;
        (SIDE.contains(&width) && SIDE.contains(&height)).then_some(Self { width, height, percent })
    }

    /// `^\d{3,5}x\d{3,5}@\d{2,3}$`
    pub fn parse(text: &str) -> Option<Self> {
        let (size, percent) = text.split_once('@')?;
        let (width, height) = size.split_once('x')?;
        Some(Self { width: digits(width, 3..=5)?, height: digits(height, 3..=5)?, percent: digits(percent, 2..=3)? })
    }

    /// For people: `2560×1440 · 125 %`.
    pub fn label(&self) -> String {
        format!("{}×{} · {} %", self.width, self.height, self.percent)
    }
}

/// ASCII digits only (no sign, no spaces), of the given length.
fn digits(part: &str, len: RangeInclusive<usize>) -> Option<u32> {
    if len.contains(&part.len()) && part.bytes().all(|b| b.is_ascii_digit()) {
        part.parse().ok()
    } else {
        None
    }
}

impl fmt::Display for MonitorKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}x{}@{}", self.width, self.height, self.percent)
    }
}

impl Serialize for MonitorKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for MonitorKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Self::parse(&text).ok_or_else(|| serde::de::Error::custom(format!("invalid monitor key {text:?}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_and_parses() {
        let key = MonitorKey::new(2560, 1440, 1.25).unwrap();
        assert_eq!(key.to_string(), "2560x1440@125");
        assert_eq!(MonitorKey::parse("2560x1440@125"), Some(key.clone()));
        assert_eq!(key.label(), "2560×1440 · 125 %");
        assert_eq!(MonitorKey::new(1080, 1920, 1.0).unwrap().to_string(), "1080x1920@100");
    }

    #[test]
    fn every_key_it_makes_can_be_read_back() {
        for (w, h) in [(99, 1080), (1920, 99), (100_000, 1080), (0, 0)] {
            assert_eq!(MonitorKey::new(w, h, 1.0), None, "{w}x{h}");
        }
        for (w, h, scale) in [(100, 100, 0.01), (99_999, 99_999, 50.0), (640, 480, 1.0)] {
            let key = MonitorKey::new(w, h, scale).unwrap();
            assert_eq!(MonitorKey::parse(&key.to_string()), Some(key));
        }
    }

    #[test]
    fn rejects_anything_else() {
        for bad in ["", "2560x1440", "2560x1440@", "25x1440@125", "2560x1440@1250", "2560X1440@125", "+560x1440@125"] {
            assert_eq!(MonitorKey::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn rounds_fractional_scales() {
        assert_eq!(MonitorKey::new(3840, 2160, 1.749_999).unwrap().to_string(), "3840x2160@175");
    }
}

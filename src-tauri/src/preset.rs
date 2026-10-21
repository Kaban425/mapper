//! The two fixed map zooms Mapper measures on. Each has its own hotkey and its own one-time scale.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    /// Map zoomed in all the way (short and medium distances).
    Near,
    /// Map zoomed out all the way (long distances).
    Far,
}

impl Preset {
    pub const ALL: [Preset; 2] = [Preset::Near, Preset::Far];

    pub fn index(self) -> usize {
        match self {
            Preset::Near => 0,
            Preset::Far => 1,
        }
    }

    pub fn other(self) -> Preset {
        match self {
            Preset::Near => Preset::Far,
            Preset::Far => Preset::Near,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Preset::Near => "near",
            Preset::Far => "far",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_and_other_are_consistent() {
        for preset in Preset::ALL {
            assert_eq!(Preset::ALL[preset.index()], preset);
            assert_ne!(preset.other(), preset);
            assert_eq!(preset.other().other(), preset);
        }
    }

    #[test]
    fn serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Preset::Near).unwrap(), "\"near\"");
        assert_eq!(serde_json::from_str::<Preset>("\"far\"").unwrap(), Preset::Far);
    }
}

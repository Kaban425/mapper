pub mod service;
pub mod spec;

pub use service::{HotkeyError, HotkeyService, HotkeyStatus, HotkeysState, Registrar, StatusError};
pub use spec::HotkeySpec;

/// Defaults chosen by the author; Alt+Q was checked in game (free look does not stick).
pub const DEFAULT_NEAR: &str = "Alt+Q";
pub const DEFAULT_FAR: &str = "Alt+W";

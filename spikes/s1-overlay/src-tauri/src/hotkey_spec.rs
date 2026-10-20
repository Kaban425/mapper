//! Parsing of user-facing hotkey strings such as "Alt+Q" into RegisterHotKey arguments.
//! Pure code without Win32 calls so it can be unit-tested on any machine.

use std::fmt;

pub const MOD_ALT: u32 = 0x0001;
pub const MOD_CONTROL: u32 = 0x0002;
pub const MOD_SHIFT: u32 = 0x0004;
pub const MOD_WIN: u32 = 0x0008;

const VK_F12: u32 = 0x7B;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HotkeySpec {
    pub modifiers: u32,
    pub vk: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyParseError {
    Empty,
    UnknownToken(String),
    DuplicateModifier(String),
    MissingKey,
    MultipleKeys,
    /// F12 is reserved by Windows for the debugger and cannot be registered.
    Reserved(String),
}

impl fmt::Display for HotkeyParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "hotkey is empty"),
            Self::UnknownToken(t) => write!(f, "unknown key '{t}'"),
            Self::DuplicateModifier(t) => write!(f, "modifier '{t}' is repeated"),
            Self::MissingKey => write!(f, "hotkey needs a main key, not only modifiers"),
            Self::MultipleKeys => write!(f, "hotkey can have only one main key"),
            Self::Reserved(t) => write!(f, "'{t}' is reserved by Windows"),
        }
    }
}

impl std::error::Error for HotkeyParseError {}

fn modifier_bit(token: &str) -> Option<u32> {
    match token {
        "alt" => Some(MOD_ALT),
        "ctrl" | "control" => Some(MOD_CONTROL),
        "shift" => Some(MOD_SHIFT),
        "win" | "super" | "meta" => Some(MOD_WIN),
        _ => None,
    }
}

fn key_code(token: &str) -> Option<u32> {
    let bytes = token.as_bytes();
    if bytes.len() == 1 {
        let c = bytes[0].to_ascii_uppercase();
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            return Some(u32::from(c));
        }
        if c == b'`' {
            return Some(0xC0);
        }
    }
    if let Some(n) = token.strip_prefix('f').and_then(|n| n.parse::<u32>().ok()) {
        if (1..=24).contains(&n) {
            return Some(0x70 + n - 1);
        }
    }
    if let Some(n) = token.strip_prefix("numpad").and_then(|n| n.parse::<u32>().ok()) {
        if n <= 9 {
            return Some(0x60 + n);
        }
    }
    let code = match token {
        "space" => 0x20,
        "tab" => 0x09,
        "insert" | "ins" => 0x2D,
        "delete" | "del" => 0x2E,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" | "pgup" => 0x21,
        "pagedown" | "pgdn" => 0x22,
        "backquote" | "tilde" => 0xC0,
        "pause" => 0x13,
        _ => return None,
    };
    Some(code)
}

pub fn parse(input: &str) -> Result<HotkeySpec, HotkeyParseError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(HotkeyParseError::Empty);
    }
    let mut modifiers = 0;
    let mut vk = None;
    for raw in trimmed.split('+') {
        let token = raw.trim().to_ascii_lowercase();
        if token.is_empty() {
            return Err(HotkeyParseError::UnknownToken(raw.to_string()));
        }
        if let Some(bit) = modifier_bit(&token) {
            if modifiers & bit != 0 {
                return Err(HotkeyParseError::DuplicateModifier(raw.trim().to_string()));
            }
            modifiers |= bit;
            continue;
        }
        let code = key_code(&token).ok_or_else(|| HotkeyParseError::UnknownToken(raw.trim().to_string()))?;
        if code == VK_F12 {
            return Err(HotkeyParseError::Reserved(raw.trim().to_string()));
        }
        if vk.replace(code).is_some() {
            return Err(HotkeyParseError::MultipleKeys);
        }
    }
    let vk = vk.ok_or(HotkeyParseError::MissingKey)?;
    Ok(HotkeySpec { modifiers, vk })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_alt_q() {
        assert_eq!(parse("Alt+Q"), Ok(HotkeySpec { modifiers: MOD_ALT, vk: 0x51 }));
    }

    #[test]
    fn is_case_and_space_insensitive() {
        assert_eq!(parse(" ctrl + shift + f8 "), Ok(HotkeySpec { modifiers: MOD_CONTROL | MOD_SHIFT, vk: 0x77 }));
    }

    #[test]
    fn accepts_key_without_modifiers() {
        assert_eq!(parse("F7"), Ok(HotkeySpec { modifiers: 0, vk: 0x76 }));
        assert_eq!(parse("`"), Ok(HotkeySpec { modifiers: 0, vk: 0xC0 }));
        assert_eq!(parse("Numpad5"), Ok(HotkeySpec { modifiers: 0, vk: 0x65 }));
    }

    #[test]
    fn rejects_modifier_only_and_empty() {
        assert_eq!(parse("Alt"), Err(HotkeyParseError::MissingKey));
        assert_eq!(parse("   "), Err(HotkeyParseError::Empty));
    }

    #[test]
    fn rejects_bad_combinations() {
        assert_eq!(parse("Alt+Alt+Q"), Err(HotkeyParseError::DuplicateModifier("Alt".into())));
        assert_eq!(parse("Q+W"), Err(HotkeyParseError::MultipleKeys));
        assert_eq!(parse("Alt+Banana"), Err(HotkeyParseError::UnknownToken("Banana".into())));
        assert_eq!(parse("Alt++Q"), Err(HotkeyParseError::UnknownToken(String::new())));
    }

    #[test]
    fn rejects_reserved_f12() {
        assert_eq!(parse("Ctrl+F12"), Err(HotkeyParseError::Reserved("F12".into())));
    }

    #[test]
    fn maps_function_keys_range() {
        assert_eq!(parse("F1").unwrap().vk, 0x70);
        assert_eq!(parse("F24").unwrap().vk, 0x87);
        assert!(parse("F25").is_err());
    }
}

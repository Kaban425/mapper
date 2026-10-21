//! Parsing and formatting of hotkey strings such as "Alt+Q" (RegisterHotKey arguments).
//! Pure code, unit-tested on any machine.

use std::fmt;

pub const MOD_ALT: u32 = 0x0001;
pub const MOD_CONTROL: u32 = 0x0002;
pub const MOD_SHIFT: u32 = 0x0004;
pub const MOD_WIN: u32 = 0x0008;

const VK_F1: u32 = 0x70;
const VK_F12: u32 = 0x7B;
const VK_F24: u32 = 0x87;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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
    /// A plain key without a modifier would be taken away from the game and every other
    /// program; only F1–F24 are allowed alone.
    NeedsModifier(String),
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
            Self::NeedsModifier(t) => write!(f, "'{t}' needs Ctrl, Alt, Shift or Win"),
        }
    }
}

impl std::error::Error for HotkeyParseError {}

const MODIFIERS: [(u32, &str); 4] = [(MOD_CONTROL, "Ctrl"), (MOD_ALT, "Alt"), (MOD_SHIFT, "Shift"), (MOD_WIN, "Win")];

const NAMED_KEYS: [(u32, &str); 10] = [
    (0x20, "Space"),
    (0x09, "Tab"),
    (0x2D, "Insert"),
    (0x2E, "Delete"),
    (0x24, "Home"),
    (0x23, "End"),
    (0x21, "PageUp"),
    (0x22, "PageDown"),
    (0xC0, "`"),
    (0x13, "Pause"),
];

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
            return Some(VK_F1 + n - 1);
        }
    }
    if let Some(n) = token.strip_prefix("numpad").and_then(|n| n.parse::<u32>().ok()) {
        if n <= 9 {
            return Some(0x60 + n);
        }
    }
    let alias = match token {
        "ins" => "insert",
        "del" => "delete",
        "pgup" => "pageup",
        "pgdn" => "pagedown",
        "backquote" | "tilde" => "`",
        other => other,
    };
    NAMED_KEYS.iter().find(|(_, name)| name.eq_ignore_ascii_case(alias)).map(|(vk, _)| *vk)
}

fn is_function_key(vk: u32) -> bool {
    (VK_F1..=VK_F24).contains(&vk)
}

pub fn parse(input: &str) -> Result<HotkeySpec, HotkeyParseError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(HotkeyParseError::Empty);
    }
    let mut modifiers = 0;
    let mut key: Option<(u32, String)> = None;
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
        if key.replace((code, raw.trim().to_string())).is_some() {
            return Err(HotkeyParseError::MultipleKeys);
        }
    }
    let (vk, name) = key.ok_or(HotkeyParseError::MissingKey)?;
    if modifiers == 0 && !is_function_key(vk) {
        return Err(HotkeyParseError::NeedsModifier(name));
    }
    Ok(HotkeySpec { modifiers, vk })
}

fn key_name(vk: u32) -> String {
    if is_function_key(vk) {
        return format!("F{}", vk - VK_F1 + 1);
    }
    if (0x60..=0x69).contains(&vk) {
        return format!("Numpad{}", vk - 0x60);
    }
    if let Some((_, name)) = NAMED_KEYS.iter().find(|(code, _)| *code == vk) {
        return (*name).to_string();
    }
    char::from_u32(vk).map_or_else(|| format!("0x{vk:02X}"), |c| c.to_string())
}

/// Canonical text, e.g. "Ctrl+Alt+Q": the same string parse() accepts and the UI shows.
pub fn format(spec: HotkeySpec) -> String {
    let mut parts: Vec<String> =
        MODIFIERS.iter().filter(|(bit, _)| spec.modifiers & bit != 0).map(|(_, name)| (*name).to_string()).collect();
    parts.push(key_name(spec.vk));
    parts.join("+")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_defaults() {
        assert_eq!(parse("Alt+Q"), Ok(HotkeySpec { modifiers: MOD_ALT, vk: 0x51 }));
        assert_eq!(parse("Alt+W"), Ok(HotkeySpec { modifiers: MOD_ALT, vk: 0x57 }));
    }

    #[test]
    fn is_case_and_space_insensitive() {
        assert_eq!(parse(" ctrl + shift + f8 "), Ok(HotkeySpec { modifiers: MOD_CONTROL | MOD_SHIFT, vk: 0x77 }));
    }

    #[test]
    fn function_keys_may_stand_alone() {
        assert_eq!(parse("F7"), Ok(HotkeySpec { modifiers: 0, vk: 0x76 }));
        assert_eq!(parse("F24").unwrap().vk, 0x87);
        assert!(parse("F25").is_err());
    }

    #[test]
    fn plain_keys_need_a_modifier() {
        for key in ["Q", "5", "Space", "Tab", "`", "Numpad5", "Insert"] {
            assert_eq!(parse(key), Err(HotkeyParseError::NeedsModifier(key.to_string())), "{key}");
        }
        assert!(parse("Ctrl+Numpad5").is_ok());
        assert!(parse("Alt+`").is_ok());
    }

    #[test]
    fn rejects_bad_combinations() {
        assert_eq!(parse("Alt"), Err(HotkeyParseError::MissingKey));
        assert_eq!(parse("   "), Err(HotkeyParseError::Empty));
        assert_eq!(parse("Alt+Alt+Q"), Err(HotkeyParseError::DuplicateModifier("Alt".into())));
        assert_eq!(parse("Alt+Q+W"), Err(HotkeyParseError::MultipleKeys));
        assert_eq!(parse("Alt+Banana"), Err(HotkeyParseError::UnknownToken("Banana".into())));
        assert_eq!(parse("Alt++Q"), Err(HotkeyParseError::UnknownToken(String::new())));
        assert_eq!(parse("Ctrl+F12"), Err(HotkeyParseError::Reserved("F12".into())));
    }

    #[test]
    fn format_round_trips() {
        for text in ["Alt+Q", "Ctrl+Alt+Shift+Win+F8", "F7", "Ctrl+Space", "Alt+`", "Shift+Numpad3", "Ctrl+PageDown"] {
            let spec = parse(text).unwrap();
            assert_eq!(format(spec), text);
            assert_eq!(parse(&format(spec)), Ok(spec));
        }
    }

    #[test]
    fn format_orders_modifiers_canonically() {
        assert_eq!(format(parse("shift+alt+ctrl+q").unwrap()), "Ctrl+Alt+Shift+Q");
    }
}

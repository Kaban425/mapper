use windows::Win32::Globalization::GetUserDefaultUILanguage;

const LANG_RUSSIAN: u16 = 0x19;

/// Windows display language is Russian (any region). Decides the first-run language.
pub fn is_russian_ui() -> bool {
    // SAFETY: no arguments; returns a LANGID.
    let langid = unsafe { GetUserDefaultUILanguage() };
    langid & 0x3FF == LANG_RUSSIAN
}

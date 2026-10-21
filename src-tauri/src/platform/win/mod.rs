//! Every `unsafe` Win32 call in Mapper lives under this module (checked by the guard).

pub mod dialog;
pub mod focus;
pub mod hotkey;
pub mod locale;
pub mod raw_input;
pub mod single_instance;
pub mod webview;
pub mod window_style;

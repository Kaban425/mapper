# Mapper

A ruler for the PUBG: BATTLEGROUNDS map. Two clicks on the map give you the distance, the travel
time on foot and by Dacia, and the mortar range.

Free and open source, MIT license. Windows 10 and 11 only. Mapper is not affiliated with KRAFTON.
[Русский](README.md)

## Honest about the risk

Nobody can guarantee you won't be banned — no third-party program can, and neither can Mapper.
Mapper is a separate ruler app: it does not inject into the game, read its memory, files or
processes, take screenshots, or press keys for you. You place every point yourself, and the math
uses the map grid and public game constants, so the technical risk is low. However, PUBG's rules
prohibit programs not permitted by KRAFTON that give an unfair advantage, and there is no official
approval or list of allowed programs. Whether that risk is acceptable is your decision. Don't use
Mapper in tournaments; in Ranked matches, it's your call.

## What Mapper does and doesn't do

| Does | Doesn't |
|---|---|
| shows a window over the game only after your hotkey | read the game's memory, files or processes |
| calculates from the points you placed | take screenshots or recognize the map |
| outside its own windows, listens only to its two hotkeys (`RegisterHotKey`) | press keys or move the mouse for you |
| on a hotkey, remembers which window was in front and gives it the focus back on Esc | look for the game window or know whether the game is running |
| reads where the cursor is when you press a hotkey, to open the ruler on that monitor | ask for administrator rights |
| checks GitHub for a new version once a day (can be turned off) | collect data about you |

## Install

1. Download one of the files from the [releases page](../../releases/latest):
   - `Mapper_<version>_x64-setup.exe` — the installer. Installs for the current user without
     administrator rights; you can pick the folder (`%LOCALAPPDATA%\Mapper` by default).
   - `Mapper_<version>_x64_portable.exe` — portable: runs from any folder without installing.
2. The files are not code-signed, so Windows SmartScreen may warn. Click "More info" → "Run anyway".
3. Optionally check the file. `Get-FileHash .\Mapper_<version>_x64-setup.exe` in PowerShell should
   print the same SHA-256 as the release notes and `SHA256SUMS.txt`. `gh attestation verify`
   confirms the file was built by GitHub Actions from this repository's sources — the exact
   command is in every release's notes.

Mapper shows its windows with WebView2. Windows 10 and 11 usually have it; the installer adds it
if they don't.

### Uninstall

- **Installer:** Settings → Apps → Installed apps → Mapper → Uninstall. Start with Windows goes
  with it. The "Delete the application data" box also erases the settings and the calibration —
  leave it clear if you plan to come back.
- **Portable:** turn off "Start with Windows" in the settings, quit Mapper (tray icon → "Exit") and
  delete the file.

## First run

A four-step wizard: how it works and the language, the risk, the display mode, the two rulers.

- In PUBG, choose Fullscreen (Windowed): Settings → Graphics → Display Mode. In exclusive
  fullscreen the ruler is not visible.
- Start Steam and PUBG normally, not as administrator — otherwise Windows won't pass the hotkeys to
  Mapper.
- The scale is set once per monitor, most easily in Training Mode: zoom the map all the way in and
  press `Alt+Q` (100 m cells), then all the way out and press `Alt+W` (1 km cells). The wizard
  shows where to click.

## How to use it

Open the map and scroll the wheel all the way: zoomed in — `Alt+Q` (short and medium distances, up
to ~600 m), zoomed out — `Alt+W` (long ones). Click the points of your route. Esc takes you back to
the game; the result stays visible in a small panel for another 10 seconds.

| Key | Does |
|---|---|
| Left click | place a point |
| Right click or Backspace | remove the last one |
| Delete | remove all points |
| Wheel | target height ±1 m (Shift — ±10 m) |
| Ctrl+wheel | fine-tune the scale (Ctrl+Shift — finer) |
| Middle button | move the grid's origin |
| G | show or hide the grid |
| C | set the scale again |
| H | all keys |
| Esc or the same hotkey | back to the game |
| the other hotkey | switch zoom: the route is kept |

Hotkeys can be changed in the settings. Letters and digits need Alt or Ctrl; F-keys work alone.

## If something is wrong

- **I press `Alt+Q` in game and nothing happens.** Press it on the desktop. If the ruler opens
  there but not in game, PUBG or Steam runs as administrator: Windows doesn't pass hotkeys from
  such a window to a normal program. Start them normally.
- **After the hotkey the ruler isn't visible, the game minimized or flickered.** PUBG is in
  exclusive fullscreen. Choose Fullscreen (Windowed).
- **The grid doesn't match the map.** Is the map zoomed all the way? The right hotkey: `Alt+Q` —
  zoomed in, `Alt+W` — zoomed out. After changing the game resolution or the Windows scale, set
  the scale again. A small mismatch is fixed with Ctrl+wheel right in the measurement.
- **The numbers are off by 10×.** The 1 km and 100 m cells were mixed up during setup. Click
  "Recalibrate" and choose the other cells.
- **Discord and NVIDIA overlays.** We are testing them together with Mapper before version 1.0.
  If something gets in the way, open an [issue](../../issues).

## Your data and the network

- Settings and calibration: `%APPDATA%\dev.mapper.app\config.json`. Log:
  `%LOCALAPPDATA%\dev.mapper.app\logs\mapper.log`. Both folders open from "About".
- The only network request goes once a day straight to GitHub Releases. It carries no data about
  you; like any website, GitHub sees your IP address, the Mapper version and when the check
  happens. You can turn it off in the settings.

## Why the exe contains SendInput and similar functions

Mapper's windows are built with Tauri (Rust + WebView2). Its libraries (tao, muda, wry, softbuffer)
import a few Windows functions that look suspicious. Mapper either never calls them or calls them
only for its own windows. Every build checks that the import list hasn't changed
(`antiban/imports-baseline.txt`), and Mapper's own Win32 calls are checked separately
(`antiban/own-imports.txt`).

| Function | Where from and why |
|---|---|
| `SendInput` | tao — only for `set_focus` and fullscreen; muda — for the predefined Copy, Paste and similar menu items. Mapper uses neither: the guard bans them in the sources |
| `SetCursorPos` | tao `set_cursor_position`; banned in the sources and the window permissions |
| `ClipCursor` | tao `set_cursor_grab`; banned in the sources and the window permissions |
| `RegisterRawInputDevices` | tao's event loop; Mapper sets `DeviceEventFilter::Always`, and tao unregisters (`RIDEV_REMOVE`) |
| `GetRawInputData` | tao's `WM_INPUT` handler; once unregistered, no such message arrives |
| `GetAsyncKeyState` | tao reads the key state once when a Mapper window gets the focus; no polling |
| `GetKeyboardState` | tao reads its own message queue's key state while translating key presses in Mapper's windows |
| `GetCursorPos` | once per hotkey press, to pick the monitor the ruler opens on |
| `FindWindowExW` | tauri-runtime-wry looks up its own child window inside Mapper's window |
| `BitBlt` | softbuffer copies its pixel buffer into its own window — drawing, not capture |
| `GetDIBits` | tauri converts Mapper's icon to RGBA |

## How it is checked

- The **guard** (`npm run guard:all`) runs before every build: it checks the sources, the window
  permissions, the built pages, Mapper's own Win32 calls and the exe's imports, and its own tests
  plant a hundred violations and expect each to be caught. It is a net of rules, not a proof: the
  open code and review come first.
- Releases are built only by GitHub Actions; every file comes with a SHA-256 and attestations.

Building from source and adding a rule: [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities:
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Mapper is an independent project, not affiliated with KRAFTON. PUBG:
BATTLEGROUNDS is a trademark of KRAFTON, Inc.

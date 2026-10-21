# Mapper v1.0 — техническая спецификация

> RPI, шаг 3 (Plan), фаза 3, 2026-10-20. Основа: `REQUEST.md`, `research/RESEARCH.md` (§6–7),
> `research/SPIKES.md`, `plan/pm.md` (истории US-n, вопросы О-n), код `spikes/s1-overlay/`.
> Решения автора здесь не пересматриваются: документ описывает, как превратить спайк в приложение.

## 1. Обзор архитектуры

Один процесс `mapper.exe` (Tauri 2.12.4, Rust) и дочерние процессы WebView2. Все три окна
создаются из Rust с одной строкой `BROWSER_ARGS`
(`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --renderer-process-limit=1`),
поэтому делят одно окружение WebView2: один browser-процесс, один GPU-процесс и один renderer.

| Окно | Класс | Создаётся | Флаги | Фон | Содержимое |
|---|---|---|---|---|---|
| `main` | `Mapper.Main` | при старте; показано, кроме запуска с `--autostart` (О-5) | обычное окно с системной рамкой, `transparent`, 960×640 (мин. 820×560) | `MicaDark` на Windows 11 (сборка ≥ 22000), `Acrylic` с тёмным цветом на Windows 10 | мастер, статус и масштабы, настройки, «О программе» |
| `overlay` | `Mapper.Overlay` | при старте, скрыто | как в спайке: прозрачное, без рамки, topmost, `focusable`, `skipTaskbar`, размер монитора − 1 px, никогда не fullscreen | прозрачный, без размытия | замер и калибровка |
| `hud` | `Mapper.Hud` | при старте, скрыто | 380×150, click-through, `focusable:false`, topmost | `Blur` + скругление углов DWM | результат и уведомления |

Системная рамка у главного окна выбрана сознательно: не нужны права `core:window:*` на
перетаскивание и кнопки, а крестик ловится в Rust (`CloseRequested`). HUD никогда не бывает
активным, а системные подложки Mica/Acrylic у неактивного окна рисуются сплошным цветом, поэтому
у HUD эффект `Blur` (через `SetWindowCompositionAttribute` в window-vibrancy, от активности не
зависит); проверяется на скаффолде. В релиз идёт только режим
покоя V1: `hide` + `SetIsVisible(false)` + `MemoryUsageTargetLevel LOW`. Тот же режим получает
главное окно, когда оно спрятано в трей.

**Трей.** Левый клик открывает главное окно. Меню: «Открыть Mapper», «Замер: приближено (Alt+Q)»,
«Замер: отдалено (Alt+W)» (запасной путь, если хоткей занят), «Доступна версия X» (только при
наличии), «Выход». Используются только `MenuItem` и разделители: предопределённые пункты muda
синтезируют Ctrl+клавишу и запрещены guard.

**Одна копия.** До `tauri::Builder` функция `single_instance::acquire()` создаёт мьютекс
`Local\Mapper.Instance.{GUID}`. Если он уже существует, вторая копия открывает событие
`Local\Mapper.ShowMain.{GUID}`, вызывает `AllowSetForegroundWindow(ASFW_ANY)` и `SetEvent`, затем
выходит с кодом 0. Первая копия держит поток `mapper-instance`, который ждёт событие
(`WaitForSingleObject`, 0 % CPU) и показывает главное окно. Чужие окна не ищутся.

**Потоки.** `main` (цикл событий tao, все вызовы окон), `mapper-hotkeys` (очередь сообщений
`RegisterHotKey`), `mapper-timers` (единственный поток таймеров), `mapper-instance`,
`mapper-update` (живёт секунды, не чаще раза в сутки).

```text
 Пользователь                 mapper.exe (Rust, главный поток)                 WebView2 (один renderer)
 Alt+Q / Alt+W ─RegisterHotKey─► [mapper-hotkeys] ─run_on_main─► OverlayController ─overlay-activating─► overlay.html
 клики, колесо, клавиши ────────────────────────────────────────────────────────────────────────────► (lib/core:
                                                                  ▲ ◄─ save_calibration / submit_result ─  вся математика)
                                                                  │ ◄─ overlay_exit / overlay_blank ─────
                                                                  ├─ hud-show (числа + язык) ───────────► hud.html
 трей, вторая копия ─► Tray / [mapper-instance] ─► MainWindow ────┼─ snapshot-changed, navigate ────────► main.html
                                                                  │ ◄─ get_snapshot, update_settings, … ─
                       ConfigStore ◄──────────────────────────────┘ ─► %APPDATA%\dev.mapper.app\config.json (tmp → rename)
                       [mapper-timers]: повтор фокуса, тайм-ауты выхода и пустого кадра, HUD 10 с, пауза хоткеев, тик обновлений
                       [mapper-update] ─ HTTPS GET /repos/OWNER/mapper/releases/latest (ETag) ─► api.github.com
 Окно игры: только ForeignHwnd::restore() → SetForegroundWindow, один раз за замер. Больше Mapper о нём ничего не знает.
```

## 2. Структура репозитория

Корень репозитория — само приложение. `rpi/` и `spikes/` остаются как история, CI их не
собирает, guard не сканирует.

```text
mapper/
├─ src/                          фронтенд, корень Vite
│  ├─ main.html  overlay.html  hud.html
│  ├─ apps/
│  │  ├─ main/      main.ts, MainApp.svelte, screens/{FirstRun/*, Home, Settings/*, About}.svelte
│  │  ├─ overlay/   overlay.ts, OverlayApp.svelte, Measure, Calibrate, ClickToStart, layers/{Grid,Route}.svelte, Panel.svelte
│  │  └─ hud/       hud.ts, HudApp.svelte
│  └─ lib/
│     ├─ core/       constants, calibration, measurement, error, mortar, travel, ticks, format, session, exitGate (.ts)
│     ├─ i18n/       index.svelte.ts, ru.ts, en.ts
│     ├─ ipc/        transport.ts (tauri | mock), commands.ts, events.ts, types.ts, validate.ts, mock.ts
│     ├─ components/ GlassPanel, Button, Toggle, Slider, NumberField, HotkeyRecorder, Steps, StatusBadge (.svelte)
│     └─ styles/     tokens.css, base.css, glass.css
├─ src-tauri/
│  ├─ Cargo.toml  Cargo.lock  build.rs  tauri.conf.json  windows-app-manifest.xml
│  ├─ capabilities/  main.json  overlay.json  hud.json
│  ├─ nsis/hooks.nsh             удаление записи автозапуска при деинсталляции
│  ├─ icons/  tests/{ipc-fixtures,config}/*.json
│  └─ src/
│     ├─ main.rs                 single instance → Builder → run
│     ├─ app/        mod.rs (setup), windows.rs, main_window.rs, hud.rs, tray.rs, snapshot.rs, timers.rs,
│     │              overlay/{mod.rs, phase.rs, placement.rs}
│     ├─ commands/   mod.rs (COMMANDS, handler, expect_window), main_window.rs, overlay.rs, shared.rs, error.rs
│     ├─ config/     mod.rs (типы), store.rs, migrate.rs, validate.rs, monitor_key.rs
│     ├─ hotkeys/    spec.rs, service.rs
│     ├─ update/     mod.rs, github.rs, version.rs
│     ├─ logging.rs
│     └─ platform/win/  focus.rs, hotkey.rs, window_style.rs, raw_input.rs, webview.rs, single_instance.rs,
│                       autostart.rs, shell.rs, locale.rs, dialog.rs
├─ tests/        golden/*.json, e2e/*.spec.ts
├─ scripts/      antiban-guard.mjs, guard/*.mjs, check-version.mjs, bump-version.mjs, release-notes.mjs
├─ antiban/      imports-baseline.txt, own-imports.txt, acl.json, npm-allowlist.json, fixtures/violations/*
├─ docs/         in-game-checklist.md, perf.md, dependency-audit.md, images/
├─ .github/      workflows/{checks,pr,release}.yml, ISSUE_TEMPLATE/{bug,dpi,resolution}.yml, pull_request_template.md
├─ rpi/  spikes/
├─ package.json  package-lock.json  vite.config.ts  svelte.config.js  tsconfig.json  vitest.config.ts
├─ playwright.config.ts  rust-toolchain.toml (1.99.1, clippy, rustfmt)  deny.toml
└─ README.md  README.en.md  LICENSE  CHANGELOG.md  CONTRIBUTING.md  SECURITY.md  .gitignore
```

`.gitignore`: `dist/`, `node_modules/`, `coverage/`, `test-results/`, `src-tauri/target/`,
`src-tauri/gen/`, `spikes/**/dist/`. Локально `CARGO_TARGET_DIR=%LOCALAPPDATA%\mapper-target`
(вне OneDrive), это описано в CONTRIBUTING; в CI — каталог по умолчанию.

| Спайк | v1.0 | Что меняется |
|---|---|---|
| `hotkey_spec.rs` | `hotkeys/spec.rs` | как есть + правило «буквы, цифры, Space, Tab, `` ` `` только с модификатором» и запрет клавиш замера (US-11); тесты сохраняются |
| `platform/win/hotkey.rs` | то же | + канал запросов: перерегистрация, пробная регистрация, пауза |
| `focus.rs` | то же | переписан на `OwnHwnd` / `ForeignHwnd`, логика прежняя |
| `window_style.rs` | то же | без `set_cloaked` (V2); + скругление углов; принимает только `OwnHwnd` |
| `raw_input.rs` | то же | + `ensure_none()` с отказом запуска |
| `webview_power.rs` | `webview.rs` | + отказ на permission request, настройки WebView2 |
| `overlay.rs` | `app/overlay/` | чистая машина фаз отдельно; без V2/V3, `cycle`, `stats`; таймеры через общий поток |
| `log.rs`, `main.rs` | `logging.rs`, `main.rs` + `app/` | переписаны; флаги экспериментов убраны, остаётся только `--autostart` |
| `cycle.rs`, `stats.rs` | — | остаются в спайке (стенд S-2) |
| `ui/overlay.js` | `lib/core` + Svelte | логика и константы как есть (стадии мастера, шаги колеса, модель ошибки, ожидание отпускания клавиш); localStorage → конфиг в Rust |
| `ui/hud.*`, `*.css` | Svelte + `styles/` | HUD получает типизированные числа вместо строк; новый дизайн |
| `antiban-guard.mjs`, `deny.toml`, `imports-baseline.txt`, манифест | корень | правила как есть + доработки §7 |
| `capabilities/default.json`, `tauri.conf.json` | три capability, новый конфиг | ACL по окнам, `withGlobalTauri:false`, NSIS |
| `dist/ui-harness/stub.js` | `lib/ipc/mock.ts` + Playwright | та же идея заглушки, но типизированная |

## 3. Rust-модули

**Порядок запуска (`main.rs`, `app/mod.rs`).** `single_instance::acquire()` → `tauri::Builder` с
`.device_event_filter(tauri::DeviceEventFilter::Always)`, состояниями и обработчиком команд →
`setup`: журнал (версия, сборка Windows, версия WebView2, мониторы) → `raw_input::ensure_none()` →
`ConfigStore::load()` → три окна → трей → хоткеи → поток `mapper-instance` → планировщик
обновлений → проверка пути автозапуска. Ошибка любого шага до хоткеев — `dialog::fatal()`
(`MessageBoxW` с кодом ошибки) и выход с кодом 2.

**`hotkeys` — сервис горячих клавиш.** `RegisterHotKey(NULL, …)` привязан к потоку, поэтому все
регистрации делает `mapper-hotkeys`. Запросы идут через `mpsc` и будят поток сообщением
`WM_APP`; ответ возвращается через одноразовый канал.

```rust
pub enum Request { Apply(Vec<Binding>), Probe(HotkeySpec), Suspend, Resume }
pub struct HotkeyService { /* поток, текущие Binding, suspended */ }
impl HotkeyService {
    pub fn start(cfg: &Hotkeys, on_press: impl Fn(Preset, Instant) + Send + 'static) -> (Self, [HotkeyStatus; 2]);
    /// Разбор → near ≠ far → пробная регистрация (id 0xBFFF, сразу снимается) → замена → при ошибке откат.
    pub fn set(&mut self, preset: Preset, accelerator: &str) -> Result<HotkeyStatus, HotkeyError>;
    pub fn suspend(&mut self);                 // на время записи хоткея в настройках
    pub fn resume(&mut self) -> [HotkeyStatus; 2];
    pub fn retry_failed(&mut self) -> [HotkeyStatus; 2]; // при показе главного окна
}
```

Логика замены и отката тестируется через трейт `Registrar` с фейковой реализацией. Пауза
снимается командой, потерей фокуса главным окном или через 30 с.

**`platform/win/focus.rs`.** Единственный файл с `Get/SetForegroundWindow`.

```rust
/// Окно Mapper. Получить можно только из своего WebviewWindow.
#[derive(Clone, Copy, PartialEq, Eq)] pub struct OwnHwnd(isize);
impl OwnHwnd { pub fn of(win: &tauri::WebviewWindow) -> Option<Self>; }

/// Чужое окно, активное до хоткея. Ни геттеров, ни Clone/Copy/Debug:
/// единственная операция — вернуть ему фокус, один раз (self потребляется).
pub struct ForeignHwnd(std::num::NonZeroIsize);
impl ForeignHwnd { pub fn restore(self) -> bool; } // IsWindow + SetForegroundWindow

pub enum Foreground { None, Own(OwnHwnd), Foreign(ForeignHwnd) }
pub fn capture_foreground(own: &[OwnHwnd]) -> Foreground;
pub fn try_activate(win: OwnHwnd) -> bool;
```

**`window_style.rs`.** `set_tool_window(OwnHwnd)` (переустановка `WS_EX_TOOLWINDOW` +
`SWP_FRAMECHANGED | SWP_NOACTIVATE` после каждой смены флагов tao), `suppress_key_menu(OwnHwnd,
KeyMenu::All)` для оверлея и `KeyMenu::PlainAlt` для главного окна (Alt+Space остаётся),
`set_round_corners(OwnHwnd)` (`DWMWA_WINDOW_CORNER_PREFERENCE`, только Windows 11).

**`raw_input.rs`.** `ensure_none()` при старте и при каждой активации оверлея: если
`GetRegisteredRawInputDevices` > 0, оверлей не показывается, в журнал пишется ошибка, `fatal()`
сообщает «Mapper остановлен: обнаружена регистрация raw input» и приложение выходит.

**`webview.rs`.** `set_idle(win, bool)` из спайка и `harden(win)` для всех окон: обработчик
`PermissionRequested` всегда ставит `DENY`; отключены контекстное меню по умолчанию, строка
состояния, браузерные ускорители (F5, Ctrl+R/P/F, F12), автозаполнение и сохранение паролей.
Билдеры дополнительно получают `zoom_hotkeys_enabled(false)` (Ctrl+колесо не зумит страницу),
`disable_drag_drop_handler()`, `on_navigation` (только собственный origin приложения) и
`on_new_window` с отказом.

**`app/overlay` — контроллер и фазы.** `phase.rs` — чистая функция
`step(&State, Input) -> (State, Vec<Effect>)` по фазам спайка `Hidden → Activating → Active →
Deactivating → Hidden`. Входы: хоткей пресета, результат попытки фокуса, `Focused`/`FocusLost`,
`overlay_exit`, `overlay_blank`, тайм-ауты, выход из приложения. Эффекты: захватить foreground,
поставить окно на монитор, показать, отправить событие, попробовать фокус (4 попытки через
30 мс), запланировать таймер, сделать окно click-through, вернуть фокус, скрыть. `mod.rs`
исполняет эффекты, не держа блокировку во время вызовов окон (правило спайка). Сохраняются
правила спайка: хоткей во время `Activating` закрывает оверлей; чужой хоткей в `Active`
переключает пресет; свой хоткей — запрос выхода, который UI завершает после отпускания всех
клавиш (страховка 1 с); потеря фокуса — сразу click-through и пустой кадр; нет фокуса за 4
попытки — «кликните, чтобы начать», через 3 с выход; пустой кадр перед скрытием (ожидание 150 мс).
Режим `calibrate` выбирается, если пресет «взведён» из главного окна или для этого монитора
нет масштаба. Взвод снимается после сохранения, отмены или через 10 минут. `placement.rs`
выбирает монитор (закреплённый, иначе под курсором, иначе основной), считает `MonitorKey` и
ставит окно в физических пикселях, повторяя `set_size` после `WM_DPICHANGED`.

**`app/hud.rs`.** `show(payload)`: позиция по центру сверху на мониторе оверлея (отступ 24 CSS px),
`set_idle(false)`, `emit_to("hud", "hud-show")`, показ, таймер 10 с с номером поколения, затем
скрытие и `set_idle(true)`. Уведомления: «хоткей занят» при автозапуске, «Mapper работает в трее»
при первом закрытии окна.

**`app/main_window.rs`.** `CloseRequested` → `prevent_close`, скрыть, `set_idle(true)`, при первом
закрытии уведомление в HUD. `show(screen)` → `set_idle(false)`, `show`, `unminimize`,
`focus::try_activate` (без tao `set_focus`), `emit_to("main", "navigate")`, `retry_failed()`
хоткеев. Выход (`quit_app`, трей): если идёт замер, оверлей закрывается по обычным правилам с
возвратом фокуса, затем хоткеи снимаются (`Drop`) и вызывается `app.exit(0)`.

**`app/tray.rs`.** Таблица из шести строк RU/EN, тексты обновляются через `set_text` при смене
языка; подсказка показывает хоткеи или «хоткей занят». Тест проверяет полноту обеих таблиц.

**`config`.** Rust — единственный владелец конфига; UI получает снимок, пишет только командами.
Файл `app_config_dir()/config.json`. Запись: сериализация → `config.json.tmp` → `sync_all` →
`rename` поверх старого. Битый JSON переименовывается в `config.broken-<unix>.json`, приложение
стартует с настройками по умолчанию и уведомлением `config-reset`. `schemaVersion` новее
известной — режим только чтения и уведомление `config-newer`, файл не перезаписывается.
Миграции — цепочка `fn(serde_json::Value) -> Value` по версиям, затем `validate()` приводит
значения к допустимым диапазонам. Ограничения: файл ≤ 256 КиБ, ≤ 16 ключей мониторов (лишние
удаляются по `createdAt`). Ключ монитора — `"{ширина}x{высота}@{масштаб %}"` монитора, например
`2560x1440@125` или `1080x1920@100`: одинаковые мониторы с одинаковым масштабом дают одинаковый
масштаб карты, позиция монитора не важна. Запись калибровки хранит размер оверлея в CSS px и
`scale`; при загрузке она годится, только если размер совпадает с текущим с точностью до 1 px
(правило спайка `fitsViewport`).

**`update`.** `ureq` 3 (`default-features = false`, `features = ["rustls"]`: rustls + ring,
корни из встроенного `webpki-roots`, без системного хранилища сертификатов). Запрос
`GET https://api.github.com/repos/OWNER/mapper/releases/latest`, заголовки `User-Agent:
Mapper/<версия> (+https://github.com/OWNER/mapper)`, `Accept: application/vnd.github+json`,
`If-None-Match: <etag>`. Тайм-аут 10 с, тело ≤ 256 КиБ, из ответа берутся только `tag_name`
(`^v\d+\.\d+\.\d+$`, ≤ 32 символа), `draft`, `prerelease`. Сравнение через `semver` с версией
приложения. 304 только обновляет время проверки. Ошибки пишутся в журнал, пользователю не
показываются. Планировщик: через 30 с после старта, затем ежечасный тик на `mapper-timers`;
запрос уходит, только если проверка включена и прошло ≥ 24 ч. Ручная кнопка — не чаще раза в
минуту. Ссылка в UI всегда константа `https://github.com/OWNER/mapper/releases/latest`, URL из
ответа не открывается. `OWNER/mapper` — одна константа `REPO` в `update/github.rs`, её же
использует `open_link`.

**`autostart` — свой HKCU Run, без плагина.** `tauri-plugin-autostart` тянет крейт `auto-launch`,
JS-обвязку и права `autostart:allow-*`, которые пришлось бы добавить в allowlist ACL и сделать
вызываемыми из WebView напрямую. Своя реализация — около 80 строк в одном файле: значение
`Mapper` в `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` с данными
`"<current_exe>" --autostart`, чтение `…\Explorer\StartupApproved\Run` только для показа «отключено
в диспетчере задач». Guard разрешает функции `Reg*` только в `platform/win/autostart.rs`, вызов
возможен только командой `set_autostart` главного окна. При старте, если автозапуск включён, а
путь exe изменился (portable перенесли), значение переписывается. Деинсталлятор NSIS удаляет
значение (`nsis/hooks.nsh`, `NSIS_HOOK_PREUNINSTALL`). Права администратора не нужны.

**`logging.rs`.** Файл `app_log_dir()/mapper.log`, при 1 МиБ переименовывается в `mapper.1.log`
(хранится один старый файл). Формат: `2026-10-20T18:04:11.512Z INFO overlay: activate #12 near,
focus OK 12.4 ms`. Строка ≤ 512 символов, управляющие символы экранируются (`\n`, `\u{1b}`), строки
UI получают префикс `ui/<окно>`, от каждого окна не больше 20 строк/с (сверх лимита — счётчик
отброшенных). В журнал не пишутся координаты точек, содержимое конфига и любые клавиши, кроме
факта срабатывания хоткея.

**`app/timers.rs`.** Один поток: двоичная куча `(Instant, задача)` + `Condvar`. Задача выполняется
через `run_on_main_thread`, устаревание проверяется номерами сессий, как в спайке. Заменяет все
`thread::spawn + sleep` спайка.

## 4. IPC-контракт

`withGlobalTauri:false`, вызовы — через `@tauri-apps/api/core` и `/event`, только из
`src/lib/ipc/`. В JS имена аргументов в camelCase (`monitorKey`). Все команды возвращают
`Result<T, IpcError>`, где `IpcError = { code }` с кодами `invalid_input`, `not_allowed`,
`stale_session`, `hotkey_invalid`, `hotkey_busy`, `hotkey_conflict`, `rate_limited`,
`read_only`, `io`; текст сообщения UI берёт из i18n по коду.

**Команды (16).**

| Команда | Аргументы | Ответ | Окно | Проверки |
|---|---|---|---|---|
| `get_snapshot` | — | `AppSnapshot` | main | — |
| `update_settings` | `patch: SettingsPatch` | `AppSnapshot` | main | `deny_unknown_fields`, диапазоны §6; хоткеи и автозапуск сюда не входят |
| `set_hotkey` | `preset`, `accelerator` (≤ 32 симв.) | `HotkeyStatus` | main | разбор, near ≠ far, пробная регистрация, откат |
| `suspend_hotkeys` | `suspended: bool` | `HotkeysState` | main | автоснятие через 30 с или при потере фокуса |
| `arm_calibration` | `preset \| null` | `AppSnapshot` | main | истекает через 10 мин |
| `reset_calibration` | `monitorKey`, `preset \| "both"` | `AppSnapshot` | main | ключ по регулярному выражению, запись существует |
| `set_autostart` | `enabled: bool` | `AutostartStatus` | main | — |
| `check_update_now` | — | `UpdateStatus` | main | ≥ 60 с между ручными проверками |
| `open_link` | `link: "releases" \| "repo" \| "issues" \| "license" \| "risk"` | `()` | main | перечисление → константный URL → `explorer` |
| `open_log_folder` | — | `()` | main | только `explorer <каталог журнала>` |
| `quit_app` | — | `()` | main | — |
| `overlay_exit` | `seq`, `reason: "esc" \| "hotkey" \| "noCalibration"` | `()` | overlay | `seq` текущей сессии, фаза `Active` |
| `overlay_blank` | `seq` | `()` | overlay | `seq` текущего скрытия |
| `save_calibration` | `seq`, `preset`, `calibration: { cellMeters, cellPx, origin }` | `()` | overlay | диапазоны; монитор, размер и масштаб Rust берёт из сессии, UI их не выбирает |
| `submit_result` | `seq`, `result: MeasurementResult` | `()` | overlay | ≤ 63 отрезков, числа конечные и в диапазонах |
| `log_line` | `level: "info" \| "warn" \| "error"`, `msg` (≤ 512) | `()` | main, overlay | лимит частоты, экранирование |

HUD не вызывает ни одной команды. Вместо `show_hud(title, lines)` спайка оверлей отдаёт Rust
только числа и перечисления (`submit_result`), а текст HUD собирает сам на своём языке. Свободного
текста между окнами нет, поэтому вопрос экранирования в HUD снят. Rust хранит последний результат
в памяти (US-10, на диск не пишется) и рассылает его HUD и главному окну.

**События Rust → UI (9).** Только `emit_to(label, …)`, широковещательный `emit` запрещён guard:
событие доходит только до своего окна.

| Событие | Получатель | Payload |
|---|---|---|
| `overlay-activating` | overlay | `OverlayActivating` (ниже) |
| `overlay-activated` | overlay | `{ seq, ok, attempts, ms }` |
| `overlay-focused` | overlay | `{ seq }` |
| `overlay-preset` | overlay | `{ seq, preset }` |
| `overlay-exit-request` | overlay | `{ seq }` |
| `overlay-blank-request` | overlay | `{ seq, reason: "exit" \| "focusLost" \| "clickTimeout" \| "quit" }` |
| `hud-show` | hud | `{ kind: "result", result, lang, opacity } \| { kind: "notice", code, lang, opacity }` |
| `snapshot-changed` | main | `AppSnapshot` |
| `navigate` | main | `{ screen: "firstRun" \| "home" \| "settings" \| "about" }` |

```ts
type Preset = "near" | "far";
interface OverlayActivating {
  seq: number; preset: Preset; start: "measure" | "calibrate";
  viewport: { w: number; h: number; scale: number };          // CSS px
  monitor: { key: string; label: string };                     // "2560×1440 · 125 %"
  calibrations: Record<Preset, Calibration | null>;            // только для этого монитора
  settings: { language: Language; panelOpacity: number; speeds: Speeds; hotkeys: Record<Preset, string> };
}
interface MeasurementResult {
  preset: Preset; totalM: number; errorM: number; segmentsM: number[]; dhM: number;
  mortar: { status: "ok" | "tooClose" | "tooFar" | "noSolution" | "notApplicable"; sightM: number | null };
  travel: { sprintS: number; daciaS: number; daciaVerified: boolean };
}
interface AppSnapshot {
  version: string; readOnly: boolean; notices: NoticeCode[];
  config: PublicConfig;                                         // Config без etag и служебных полей
  hotkeys: { near: HotkeyStatus; far: HotkeyStatus; suspended: boolean };
  monitors: { key: string; label: string; name: string; primary: boolean; pinned: boolean }[];
  armed: Preset | null;
  lastMeasurement: (MeasurementResult & { monitorKey: string; at: number }) | null;
  update: { state: "off" | "idle" | "checking" | "upToDate" | "available" | "error"; latest?: string; checkedAt?: number };
  autostart: { enabled: boolean; approvedByWindows: boolean; pathMatches: boolean };
}
interface HotkeyStatus { accelerator: string; registered: boolean; error?: "busy" | "invalid" }
```

Миномёт считается только для двух точек (О-4), для маршрута — `notApplicable`.

**ACL по окнам.** `build.rs` объявляет `AppManifest::new().commands(COMMANDS)`. После этого
Tauri отклоняет любую команду приложения, не выданную окну capability-файлом (в 2.12.4 при
наличии app-манифеста `has_app_acl_manifest` включает проверку для всех команд). Разрешения
генерируются как `allow-<команда-через-дефис>`.

```rust
// build.rs
const COMMANDS: &[&str] = &[
    "get_snapshot", "update_settings", "set_hotkey", "suspend_hotkeys", "arm_calibration",
    "reset_calibration", "set_autostart", "check_update_now", "open_link", "open_log_folder",
    "quit_app", "overlay_exit", "overlay_blank", "save_calibration", "submit_result", "log_line",
];
let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
tauri_build::try_build(
    tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS))
        .windows_attributes(windows),
).expect("failed to run tauri-build");
```

| Файл | `windows` | Разрешения |
|---|---|---|
| `capabilities/main.json` | `["main"]` | `core:event:allow-listen`, `core:event:allow-unlisten`, 11 команд главного окна, `allow-log-line` |
| `capabilities/overlay.json` | `["overlay"]` | `core:event:allow-listen`, `core:event:allow-unlisten`, `allow-overlay-exit`, `allow-overlay-blank`, `allow-save-calibration`, `allow-submit-result`, `allow-log-line` |
| `capabilities/hud.json` | `["hud"]` | `core:event:allow-listen`, `core:event:allow-unlisten` |

Вторая линия защиты: каждая команда принимает `WebviewWindow` и сначала вызывает
`expect_window(&window, MAIN)` (или `OVERLAY`), иначе `not_allowed`. Права `core:event:allow-emit`
не выдаются, поэтому UI говорит с Rust только командами.

**Валидация входа.** Аргументы — serde-структуры с `deny_unknown_fields`; после разбора
`validate.rs` проверяет диапазоны (§6), длины строк, размер массивов (`segmentsM` ≤ 63), конечность
чисел. Устаревший `seq` → `stale_session`. Предел размера тела до десериализации не нужен:
вызывать команды может только собственный локальный бандл (CSP, без `remote`, ACL).

## 5. Фронтенд

Svelte 5 (runes) + TypeScript strict, Vite 8, `@tauri-apps/api` 2.12.4, `@tauri-apps/cli`
2.12.3, версии закреплены точно. Шаблон `create-vite` `svelte-ts`, затем Tauri.

**Три точки входа, а не одна с роутом.** Каждое окно грузит только свой код: HUD — пару
килобайт без команд, оверлей — без экранов настроек. Это меньше работы общему renderer при
показе оверлея, а guard может проверить, что `src/apps/hud/**` не импортирует
`lib/ipc/commands`.

```ts
// vite.config.ts (суть)
export default defineConfig(({ mode }) => ({
  root: "src",
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  resolve: { alias: { "$transport": mode === "e2e" ? "/lib/ipc/mock.ts" : "/lib/ipc/tauri.ts" } },
  build: {
    outDir: "../dist", emptyOutDir: true, target: "es2023", sourcemap: false,
    rolldownOptions: { input: { main: abs("src/main.html"), overlay: abs("src/overlay.html"), hud: abs("src/hud.html") } },
  },
}));
```

`tauri.conf.json`: `build.frontendDist: "../dist"`, `devUrl: "http://localhost:5173"`,
`app.windows: []` (окна создаёт Rust), `withGlobalTauri: false`, CSP спайка
(`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'`),
`devCsp` с `ws://localhost:5173` только для разработки, `freezePrototype: true`, заголовок
`Permissions-Policy` из спайка, `version: "../package.json"`.

**`lib/core` — чистые функции без Svelte и DOM.**

| Модуль | Содержимое |
|---|---|
| `constants.ts` | `CLICK_ERROR_PX 1.5`, `ALIGN_ERROR_PX 0.5`, `STEP_COARSE 1.02`, `STEP_FINE 1.002`, `MIN_CELL_PX 6`, `MIN_TICK_SPACING_PX 6`, `EXIT_WAIT_MS 800`, `MAX_POINTS 64`, `GRID_MAJOR_M 1000`, `GRID_MINOR_M 100`, `MORTAR_M 700`, `MORTAR_MIN 121`, `BETA_EPS 0.001`, `MORTAR_DH_EXPERIMENTAL` (включается, если G-2 не пройден) |
| `calibration.ts` | `cellFromClicks` (большее из \|dx\|, \|dy\|), `nudge` с границами, `toggleStep` (1 км ↔ 100 м при том же м/px), `fitsViewport`, `metersPerPx`, `metersOnScreen` |
| `measurement.ts`, `ticks.ts` | длины отрезков и маршрута; засечки 100 м или 1 км при плотности < 6 px |
| `error.ts` | `1.5 px × √2 × √отрезков × м/px + длина × м/px × 0.5 px / ширина сравнённых клеток` |
| `mortar.ts` | `solveMortar(L, Δh)`: `t = Δh/L`; \|t\| < 0.001 → `R = L`; `δ = M² − 2LMt − L²`, `δ < 0` → `noSolution`; `R = (L + t(M − √δ)) / (t² + 1)`; L вне 121–700 → `tooClose`/`tooFar` |
| `travel.ts`, `format.ts` | секунды по скорости, км/ч → м/с; `Intl.NumberFormat`, «≈ 1 мин 35 с» |
| `session.ts`, `exitGate.ts` | редьюсер замера и мастера (`step → origin → neighbour → fine`), учёт зажатых клавиш и условие выхода |

Состояние окон — `$state` в `*.svelte.ts`, которые вызывают редьюсеры из `core`. SVG-слои
перерисовываются не чаще кадра (`requestAnimationFrame`). Оверлей между сессиями ничего не
хранит: всё нужное приходит в `overlay-activating`.

**i18n без перезапуска.** `ru.ts` — исходный словарь (`as const`), `en.ts` типизирован как
`Record<keyof typeof ru, string>`: пропущенный ключ — ошибка компиляции. `t(key, params)`,
множественное число через `Intl.PluralRules`, числа через `Intl.NumberFormat(lang)`. Язык главное
окно берёт из `snapshot-changed`, оверлей и HUD — из своих payload. Первый язык Rust определяет
по `GetUserDefaultUILanguage` (русский → `ru`, иначе `en`). Подпись «for PUBG: BATTLEGROUNDS»
живёт только в `i18n/*.ts` под ключом `app.subtitle`.

**Дизайн-токены (`styles/tokens.css`).** `--accent: #F2A900`, `--accent-ink`, `--accent-halo`
(тёмная обводка линии и цифр, `paint-order: stroke`), `--glass-bg: rgba(18 20 26 /
var(--panel-opacity))`, `--glass-border`, `--glass-highlight` (градиент-блик), `--text`,
`--text-dim`, `--ok`, `--warn`, `--danger`, `--radius-sm: 10px`, `--radius-lg: 18px`, `--shadow`,
`--font-ui: "Segoe UI Variable Text", "Segoe UI", system-ui`, цифры `tabular-nums`. Тема в v1.0
только тёмная. Прозрачность из настроек действует только на `--glass-bg`; линия, точки и цифры
всегда непрозрачны. В оверлее нет `backdrop-filter` (размывать нечего). Шрифты и картинки игры
не используются.

## 6. Модель данных конфига

```ts
type Language = "ru" | "en";
type MonitorKey = string;                     // ^\d{3,5}x\d{3,5}@\d{2,3}$, например "2560x1440@125"
interface Speeds { sprintMps: number; daciaKmh: number; daciaVerified: boolean }

interface Config {
  schemaVersion: 1;
  firstRunDone: boolean;                      // false
  language: Language;                         // по языку Windows
  hotkeys: Record<Preset, string>;            // { near: "Alt+Q", far: "Alt+W" }
  speeds: Speeds;                             // { sprintMps: 6.3 (3..10), daciaKmh: 120 (20..200), daciaVerified: false }
  panelOpacity: number;                       // 0.72 (0.35..1)
  monitor: { mode: "cursor" } | { mode: "pinned"; pinned: { name: string; x: number; y: number; w: number; h: number } };
  autostart: boolean;                         // false; источник истины — реестр
  updates: { enabled: boolean; lastCheckUnix: number; etag: string | null; latest: string | null }; // enabled: true (О-6)
  calibrations: Record<MonitorKey, Partial<Record<Preset, Calibration>>>;
}
interface Calibration {
  cellMeters: 100 | 1000;                     // какие клетки совмещали
  cellPx: number;                             // размер клетки, CSS px, 6..8000
  origin: { x: number; y: number };           // пересечение сетки, CSS px
  w: number; h: number;                       // размер оверлея, CSS px (монитор − 1 px)
  scale: number;                              // scale factor монитора, 0.5..5
  createdAt: string;                          // ISO 8601, UTC
}
type SettingsPatch = Partial<Pick<Config, "language" | "speeds" | "panelOpacity" | "monitor" | "firstRunDone">>
  & { updatesEnabled?: boolean };             // хоткеи и автозапуск — отдельными командами
```

```rust
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub schema_version: u32,
    pub first_run_done: bool,
    pub language: Language,
    pub hotkeys: Hotkeys,
    pub speeds: Speeds,
    pub panel_opacity: f64,
    pub monitor: MonitorMode,                 // #[serde(tag = "mode")] Cursor | Pinned { pinned: MonitorRef }
    pub autostart: bool,
    pub updates: UpdatePrefs,
    pub calibrations: BTreeMap<MonitorKey, PresetCalibrations>, // MonitorKey — newtype с parse/format
}
```

`identifier` в `tauri.conf.json` — `dev.mapper.app`: от него зависят каталоги конфига, журнала и
WebView2, поэтому он не связан с `OWNER` и после первого релиза не меняется.

Закреплённый монитор ищется сначала по имени (`\\.\DISPLAY2`), затем по позиции и размеру; не
найден — режим «под курсором» и уведомление `pinned-monitor-missing` (US-14). Скорость Dacia по
умолчанию — заглушка спайка 120 км/ч с `daciaVerified: false` (О-1, выбирает автор). Когда U-3
даст цифру, миграция схемы заменит значение, только если пользователь его не менял.

## 7. Анти-бан

Guard переезжает в `scripts/antiban-guard.mjs` (точка входа) и `scripts/guard/*.mjs` (модули
правил), данные — в `antiban/`, `deny.toml` — в корень (запуск
`cargo deny --manifest-path src-tauri/Cargo.toml check --config deny.toml`). Все проверки спайка
сохраняются; ниже — доработки из ревью и новые.

1. **Разбор исходников токенизатором.** Rust: собственный небольшой лексер в guard отделяет
   комментарии (включая вложенные `/* */`), строки, raw-строки `r#"…"#` и символьные литералы;
   правила об API применяются к коду, правила об именах игры и `explorer` — к строкам. `syn`
   отвергнут: guard написан на Node и должен работать без сборки Rust. TS/JS: сканер
   `typescript` (уже нужен `svelte-check`). `.svelte` сначала компилируется
   `svelte/compiler.compile()`, чтобы проверить и шаблон, и скрипт. Ограничение (идентификаторы,
   собранные макросами) закрывает проверка объектного файла (п. 6).
2. **Новые правила для Rust.** `unsafe` только в `platform/win/**`; функции реестра — только в
   `autostart.rs`; `ureq` — только в `update/`; `AllowSetForegroundWindow`, мьютексы и события —
   только в `single_instance.rs`; `.effects(` — только в `app/windows.rs`; запрет `.emit(`
   (только `emit_to`); `Command::new` — только `"explorer"` и только в `shell.rs`.
3. **Правила для Svelte/TS.** `@tauri-apps/api/*` — только `core` и `event` и только в
   `src/lib/ipc/`; `src/apps/hud/**` не импортирует команды; запрещены `fetch`, `XMLHttpRequest`,
   `WebSocket`, `EventSource`, `sendBeacon`, `eval`, `new Function`, `{@html}`, `innerHTML`,
   `outerHTML`, `insertAdjacentHTML`, `document.write`, `localStorage`, `sessionStorage`,
   `indexedDB`, все API устройств и захвата из спайка. Те же группы проверяются в собранном
   `dist/**/*.js` (ловит код из npm), там же — отсутствие маркера `__MAPPER_MOCK__`.
   `listen()` в `lib/ipc/events.ts` всегда с явным `target: { kind: "WebviewWindow", label }`
   своего окна: Tauri доставляет `emit_to` по цели слушателя, а цель по умолчанию `Any` ловит
   события всех окон (ревью безопасности фазы 1, вводится в фазе 2 вместе с событиями).
4. **Обязательные строки и конфиг.** `device_event_filter(Always)`, вызов
   `raw_input::ensure_none`, манифест `asInvoker`/`uiAccess="false"`, `AppManifest::…commands(`;
   в `tauri.conf.json` (разбор JSON, не регулярка) — `withGlobalTauri:false`, `freezePrototype`,
   точная CSP, `app.windows: []`, `bundle.windows.nsis.installMode: "currentUser"`, нет `devtools`;
   три билдера с `window_classname("Mapper.` и `BROWSER_ARGS`; обработчик `PermissionRequested`.
5. **ACL по окнам.** Каждый capability-файл: ровно одно окно, без `remote` и `*`, разрешения ⊆
   `antiban/acl.json[окно]`. Совпадают четыре множества: `COMMANDS` в `build.rs`,
   `generate_handler!`, функции с `#[tauri::command]` и объединение `allow-*` из capability.
6. **Импорты собственного объектного файла.** Профиль `[profile.guard-obj]` (`inherits =
   "release"`, `lto = false`, `codegen-units = 1`): при fat LTO код зависимостей сливается в
   один объект. Код Mapper живёт в библиотеке `mapper_lib` (бинарник `mapper` только вызывает
   `run()`), поэтому `npm run guard:obj` выполняет
   `cargo rustc --profile guard-obj --lib --locked -- --emit=obj`, затем
   `dumpbin /nologo /symbols` по `target/guard-obj/deps/mapper_lib-*.o` и собирает символы `UNDEF
   External __imp_<имя>`. Канарейка: проверка падает, если в объекте нет `__imp_RegisterHotKey`,
   `__imp_SetForegroundWindow` и `__imp_GetRegisteredRawInputDevices` — так видно, что прочитан
   нужный объект, а не пустой (ревью безопасности фазы 1). Проверено на пробном крейте с `windows 0.62.2` (raw-dylib):
   `__imp_GetForegroundWindow` и `__imp_SetForegroundWindow` видны как `UNDEF`. Любое имя из
   списка запрещённых — ошибка без исключений (baseline к нашему коду не применяется); любое
   имя вне `antiban/own-imports.txt` — ошибка, то есть новый Win32-вызов в коде Mapper требует
   явной правки allowlist в PR. `llvm-nm -u` не выбран: нужен компонент `llvm-tools`, а
   `dumpbin` guard уже требует и он есть на раннерах `windows-latest`.
7. **Импорты exe** — как в спайке: baseline из 10 строк с `# audited:` (tao 0.37.1, muda 0.20.0,
   tauri 2.12.4, tauri-runtime-wry 2.12.2, softbuffer 0.4.8), запрет импорта по ordinal, манифест
   внутри exe. Новое: в exe есть `VS_VERSIONINFO` с `ProductName Mapper`; секции PE только
   стандартные (`dumpbin /headers`, без `UPX0` и т. п.) — C-9.
8. **Зависимости.** `deny.toml`: 31 крейт спайка + `reqwest`, `tauri-plugin-http`,
   `tauri-plugin-updater`, `tauri-plugin-autostart`, `auto-launch`, `tauri-plugin-fs`,
   `tauri-plugin-process` (единственный сетевой код — `update/` на `ureq`); `[sources]` — только
   crates.io; `[licenses]` — allowlist пермиссивных лицензий; `[advisories]` — уязвимости блокируют,
   unmaintained предупреждает. npm: запрещённые пакеты спайка + `antiban/npm-allowlist.json`
   прямых зависимостей (`@tauri-apps/api`; dev: `@tauri-apps/cli`, `svelte`,
   `@sveltejs/vite-plugin-svelte`, `vite`, `typescript`, `svelte-check`, `vitest`,
   `@vitest/coverage-v8`, `fast-check`, `@playwright/test`); CI ставит `npm ci --ignore-scripts`
   (на скаффолде проверить, что сборке не нужны install-скрипты).
9. **Слова.** В `README*.md` и `src/lib/i18n/*` запрещены `safe`, `undetected`, `undetectable`.
10. **Самопроверка guard.** `antiban/fixtures/violations/` — подложенные нарушения (15 из ревью
    спайка + новые правила); `node --test scripts/guard` проверяет, что пойман каждый.

Локально: `npm run guard` (п. 1–5, 8–10, секунды), `npm run guard:obj`, `npm run guard:exe` (после
`npm run tauri build`), `npm run guard:all`. CI выполняет всё на каждом PR и повторяет п. 7 на
exe, собранном для релиза.

## 8. Тестовая стратегия

| Уровень | Инструмент | Что покрываем |
|---|---|---|
| Математика | vitest + `@vitest/coverage-v8`, порог 80 % по строкам, ветвям, функциям для `src/lib/core` (цель 95 %) | golden-векторы `tests/golden/{calibration,error,mortar,travel,ticks}.json`: 3 клетки = 300 / 3 000 м, маршрут 3 + 4 клетки = 7 000 м, L = 400 м и +5° → R ≈ 412 м, границы 121/700, δ < 0 |
| Свойства | fast-check | длина симметрична и подчиняется неравенству треугольника; м/px × k → длина × k; ошибка растёт с числом отрезков; `R(L, 0) = L`; R растёт с Δh > 0; двойной `toggleStep` — тождество; `nudge` не выходит за границы |
| UI-логика | vitest | редьюсер мастера и замера, `exitGate`, полнота и одинаковые плейсхолдеры `ru`/`en`, `ipc/validate` на фикстурах из Rust |
| Типы | `svelte-check --fail-on-warnings`, `tsc --noEmit` strict | весь `src/` |
| Rust | `cargo test`, `clippy --all-targets -D warnings`, `fmt --check` | `hotkeys/spec` (тесты спайка + новые правила), `HotkeyService` с фейковым `Registrar` (замена, откат, пауза); конфиг: значения по умолчанию, round-trip, миграции, битый файл → бэкап, новая версия → только чтение, атомарная запись во временный каталог, приведение диапазонов; `MonitorKey` parse/format и поиск закреплённого монитора; semver и теги (`v1.2.3`, prerelease, мусор), разбор ответа GitHub и 304; `phase::step` (все переходы спайка, устаревший `seq`); порядок таймеров; экранирование, обрезка и ротация журнала; `expect_window` |
| Контракт IPC | `cargo test` + vitest | Rust сериализует образцы payload в `src-tauri/tests/ipc-fixtures/*.json` (`UPDATE_FIXTURES=1` пересоздаёт, тест падает при расхождении), TS-валидаторы разбирают те же файлы |
| e2e | Playwright (Chromium) против `vite build --mode e2e` + `vite preview`, IPC через `mock.ts` (журнал вызовов, `emit` из теста) | мастер первого запуска; RU → EN без перезагрузки; запись хоткея и ответ `hotkey_busy`; калибровка `1/2 → клик → клик → колесо → Enter` и аргументы `save_calibration`; 3 клетки → 3 000 м ± N; маршрут, ПКМ; Esc закрывает только после `keyup`; переключение пресета; Ctrl+колесо, `T`, `G`; статусы миномёта; HUD с результатом и уведомлением на обоих языках; `deviceScaleFactor` 1 / 1,25 / 1,5 |

**Вручную в игре** (`docs/in-game-checklist.md`, аккаунт автора, Training Mode и матчи 8×8,
только релизная сборка из CI): нет предупреждения в лобби; карта не реагирует на клики, колесо и
клавиши во время замера; Alt не залипает после `Alt+Q` и `Alt+W` (О-3); фокус возвращается игре;
G-1 (сетка); S-4 (вертикальный монитор и смешанный DPI, ошибка клика ≤ 1 px); S-2 (вспышки на
видео 60 к/с); S-3 и G-6 (PresentMon: Independent Flip со скрытым оверлеем, p99 + ≤ 1 мс с HUD и
его размытием); G-2 (≥ 70 % попаданий первым снарядом из ≥ 10); G-5 (вместе с оверлеями Discord и
NVIDIA); контрольные замеры точности на обоих мониторах и зумах; DPI 100–200 % через настройки
Windows.

## 9. CI/CD

Все сторонние actions закреплены по SHA коммита (версия — в комментарии), по умолчанию
`permissions: contents: read`, `concurrency` отменяет устаревшие прогоны.

**`checks.yml`** (`workflow_call`, `windows-latest`, общий для PR и релиза):
`actions/checkout` → `setup-node` 24 с кэшем npm → `npm ci --ignore-scripts` → Rust 1.99.1 из
`rust-toolchain.toml` → `Swatinem/rust-cache` → установка `cargo-deny 0.20.2` → `npm run check`
(svelte-check, tsc) → `npm run test:coverage` → `npm run build` → `cargo fmt --check` →
`cargo clippy --all-targets --locked -- -D warnings` → `cargo test --locked` →
`cargo deny … check` → `npm run guard` → `node --test scripts/guard` → `npm run guard:obj` →
`npx playwright install chromium` + `npm run e2e` → `npx tauri build --no-bundle` +
`npm run guard:exe` (импорты меняются только с зависимостями, но ловить это лучше до merge).
Отчёты покрытия и Playwright выкладываются как артефакты.

**`pr.yml`** — `pull_request` и `push` в `main`, вызывает `checks.yml`. Защита ветки требует
зелёный прогон.

**`release.yml`** — `push` тега `v*.*.*` (и `workflow_dispatch` для пробного черновика),
`permissions: contents: write, id-token: write, attestations: write`:

1. `scripts/check-version.mjs`: тег = версия `package.json` = версия `Cargo.toml`, в
   `CHANGELOG.md` есть раздел этой версии; тег с `-rc.N` → prerelease.
2. Вызов `checks.yml`.
3. `tauri-apps/tauri-action@v1`: `tagName: ${{ github.ref_name }}`, `releaseName: "Mapper
   v__VERSION__"`, `releaseBody` из `scripts/release-notes.mjs` (раздел CHANGELOG + SHA256,
   команда `gh attestation verify`, ссылки на SmartScreen и текст о риске), `releaseDraft: true`,
   `args: --bundles nsis`. Получается черновик с установщиком.
4. Второй вызов `tauri-action@v1` с `releaseId` из шага 3, `args: --no-bundle`,
   `uploadPlainBinary: true` (так требует action) и `releaseAssetNamePattern` для portable;
   сборка инкрементальная. Точные имена файлов проверяются пробным `workflow_dispatch`.
5. `npm run guard:exe` по `src-tauri/target/release/mapper.exe` (тот же файл ушёл как portable и
   внутрь установщика); `guard:obj`.
6. `Get-FileHash -Algorithm SHA256` по обоим exe → `SHA256SUMS.txt`, загрузка в черновик
   (`gh release upload`).
7. `actions/attest-build-provenance` для обоих exe.
8. Черновик публикует автор вручную после просмотра; до этого релиз не виден.

NSIS: `installMode: "currentUser"` (без UAC), языки English и Russian, `webviewInstallMode:
embedBootstrapper`, `installerHooks: "nsis/hooks.nsh"`. Без UPX и обфускации. `bundle.publisher`
и `copyright` заполняют version resource.

**Версии.** Semver, тег `vX.Y.Z` (`vX.Y.Z-rc.N` — pre-release). Источник версии — `package.json`;
`tauri.conf.json` ссылается на него, `Cargo.toml` синхронизирует
`npm run version:bump X.Y.Z` (он же переносит «Unreleased» в CHANGELOG). CHANGELOG — формат Keep
a Changelog. Откат — версия-исправление; плохой релиз помечается pre-release, тогда
`releases/latest` его не отдаёт.

## 10. Производительность и ресурсы

| Метрика | Спайк | Цель v1.0 | Как проверять |
|---|---|---|---|
| Хоткей → фокус, медиана | 11–13 мс (макс. 33) | ≤ 50 мс, ≥ 49/50 | строка `activate #n … focus OK in X ms` в журнале; стенд S-1 вне репозитория |
| Показ → кадр, медиана | 26 мс | ≤ 100 мс, 0 сбоев из 100 | стенд S-2 спайка; повторить при открытом главном окне (общий renderer) |
| Пустой кадр → скрытие | 11–12 мс | ≤ 150 мс (тайм-аут) | журнал: `hidden via blank ack` против `timeout` |
| CPU в простое | 0,004–0,02 % | ≤ 0,05 % за 10 мин, главное окно в трее | внешний скрипт S-3 |
| RAM, рабочий набор | 69 МБ (два WebView) | ≤ 80 МБ с главным окном в трее; с открытым — записать | скрипт S-3, Mapper + все `msedgewebview2` |
| RAM, private | 136 МБ | записать в README | скрипт S-3 |
| Размер | exe 3,3 МБ | exe ≤ 8 МБ, установщик ≤ 8 МБ | шаг релиза |
| Игра | — | Independent Flip со скрытым оверлеем; p99 + ≤ 1 мс с HUD | PresentMon в игре |

Правила, которые держат цифры: в простое нет таймеров чаще раза в час и нет анимаций; все
скрытые окна — `SetIsVisible(false)` + LOW (в скрытой странице останавливается
`requestAnimationFrame`); главное окно без постоянных CSS-анимаций; один поток таймеров.
Скрипты замера, как и стенд, лежат вне репозитория, методика — в `docs/perf.md`.

## 11. Риски и меры

| # | Риск | Вероятность / влияние | Меры |
|---|---|---|---|
| R1 | Обновление Tauri/tao/wry/muda возвращает запрещённый путь или импорт | M / High | точные версии (`=2.12.4`), `Cargo.lock` с `--locked`, `# audited:` в baseline (guard падает при смене версии), импорты exe и собственного объекта в каждом PR, автообновления зависимостей для `tauri*`/`tao`/`wry`/`muda` отключены, чеклист аудита в `docs/dependency-audit.md` |
| R2 | Evergreen WebView2 обновляется сам и меняет прозрачность или аргументы | M / M | версия WebView2 в журнале и шаблоне issue; ручной чеклист после крупных обновлений; монитор − 1 px и пустой кадр |
| R3 | Чёрный кадр или вспышка прозрачного окна у части драйверов | L–M / M | − 1 px, пустой кадр, S-2 на видео; при массовых отчётах — `DWMWA_CLOAK` при переходах в версии-исправлении |
| R4 | Смешанный DPI и вертикальный монитор: сдвиг кликов, неверный размер | M / M | физические пиксели, повторный `set_size` после `WM_DPICHANGED`, ключ калибровки с масштабом, e2e с `deviceScaleFactor`, S-4, шаблон issue «DPI» |
| R5 | Mica/Acrylic: нет на Windows 10, у неактивного окна — сплошной цвет; системная рамка с `transparent` выглядит не так | M / L | выбор эффекта по сборке Windows (`windows-version` уже в дереве через window-vibrancy), читаемый запасной фон, проверка на скаффолде; запасной путь — своя шапка с `core:window:allow-start-dragging` в allowlist |
| R6 | Размытие HUD поверх игры стоит кадров | M / M | PresentMon с видимым HUD; если p99 > + 1 мс — HUD без размытия (константа `HUD_BLUR`) |
| R7 | Третий WebView и общий renderer: RAM > 80 МБ или задержка показа оверлея | M / M | главное окно в трее в режиме LOW; замер с открытым окном; запасной путь — уничтожать главное окно при скрытии и создавать заново |
| R8 | Хоткей занят другой программой или игра запущена от администратора (UIPI) | M / M | статус и повтор регистрации на главном экране, пункты замера в трее, FAQ |
| R9 | SmartScreen и антивирусы | High / M | SHA256, attestations, ссылка на VirusTotal в релизе, без UPX, инструкция в README; SignPath в v1.1 |
| R10 | Клетка сетки не ровно 1000 м | L / M | пользователь совмещает именно сетку игры; G-1; `GRID_MAJOR_M` — одна константа с тестом |
| R11 | Битый или чужой конфиг, перенос portable exe | L / L | атомарная запись, бэкап битого файла, режим только чтения для новой схемы, самовосстановление пути автозапуска; данные в `%APPDATA%`, а не рядом с exe (FAQ) |
| R12 | Бан по правилам (не технический) | L / High | принят автором; честный текст в мастере, «О программе» и README; правило слов в CI |

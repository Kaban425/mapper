# Mapper v1.0 — план реализации

> RPI, шаг 3 (Plan), 2026-10-20. Входы: `REQUEST.md`, `research/RESEARCH.md`, `research/SPIKES.md`,
> `plan/pm.md` (20 историй US-1…US-20, вопросы О-1…О-7), `plan/ux.md` (экраны, токены, тексты RU/EN),
> `plan/eng.md` (архитектура, 16 команд, 9 событий, guard, CI). Условия CONDITIONAL GO выполнены:
> S-1 пройден в игре, лобби без предупреждений, U-1 и U-2 пройдены.

## Сводка

| Поле | Значение |
|---|---|
| Продукт | Mapper — универсальная линейка для карты PUBG (Alt+Q приближено, Alt+W отдалено), главное окно, оверлей, HUD |
| Сложность | Medium–Complex: ядро и платформа доказаны спайком, новое — GUI, конфиг, ACL, guard, релиз |
| Фазы | 5 |
| Задачи | 46 |
| Стек | Tauri 2.12.4, Svelte 5 + TypeScript + Vite 8, Rust 1.99.1, WebView2 |
| Зависимости | внешние: tauri, ureq + rustls, windows 0.62, webview2-com 0.39, svelte, vite, vitest, fast-check, playwright; внутренние: код спайка |
| Риск | Medium (eng.md §11) |

## Согласование документов

Где pm.md, ux.md и eng.md расходятся, действует этот план:

| Тема | Решение |
|---|---|
| Хоткеи без модификатора | только F1–F24 (кроме F12); буквы, цифры, Space, Tab, `` ` `` — только с модификатором (ux §9.12 + eng hotkeys) |
| Положение HUD | слева сверху, на месте панели замера (ux §9.2); если перекрывает элементы игры — вернуть центр сверху, как в спайке; проверка в игре |
| Рамка главного окна | стандартная рамка Windows + Mica (Windows 11) / Acrylic (Windows 10) (ux §9.13, eng §1) |
| Размытие HUD | `Blur` (HUD никогда не активен); константа `HUD_BLUR` на случай штрафа к FPS (eng R6) |
| Миномёт | только для 2 точек; маршрут — `notApplicable` (О-4, ux §9.5) |
| Автозапуск | свой HKCU Run, старт в трей; окно открывается, только если хоткей занят (О-5, ux §9.9) |
| Тема | только тёмная в v1.0 |
| Калибровка | шаги мастера из спайка + шаг назад (ПКМ/Backspace), «шаг N из 4», проверка «3 клетки» после Enter, предупреждение о 10× по порогу (уточнить в игре) |
| Лицензия | MIT (О-2): убрать «уточнить» из REQUEST.md |

Ответы автора на открытые вопросы — в последнем разделе (Dacia 100 км/ч, обновления включены,
Git с коммитом на каждую фазу).

## Подготовка (до фазы 1)

- P-1. `git init` в корне `mapper/`, `.gitignore` (eng §2), первый коммит с `rpi/` и `spikes/`
  (без `dist/`). Автор согласен: коммит в конце каждой фазы, без отправки на GitHub.
- P-2. Локальная сборка вне OneDrive: `CARGO_TARGET_DIR=%LOCALAPPDATA%\mapper-target` (CONTRIBUTING).
- P-3. Ветки: работа в `main` локально; публикация на GitHub — сам автор, после замены `OWNER`.

## Фаза 1. Каркас и платформа

- [x] Фаза 1: PASS (2026-10-21), подробности в `implement/IMPLEMENT.md`.

Цель: приложение запускается, три окна создаются скрытыми, трей и хоткеи работают, guard и тесты
зелёные. Всё платформенное переносится из спайка с доработками ревью.

| ID | Задача | Сложн. | Зависит | Где |
|---|---|---|---|---|
| T1.1 | Каркас: Vite 8 + Svelte 5 + TS strict, три входа (`main/overlay/hud.html`), `@tauri-apps/api` и `cli` точных версий, `package.json` скрипты | M | P-1 | корень, `src/` |
| T1.2 | `src-tauri`: Cargo с `=2.12.4`, `rust-toolchain.toml`, профили `release` и `guard-obj`, `build.rs` с `AppManifest::commands` и манифестом `asInvoker` | M | T1.1 | `src-tauri/` |
| T1.3 | `tauri.conf.json`: `withGlobalTauri:false`, CSP/devCsp, `freezePrototype`, Permissions-Policy, `app.windows: []`, NSIS `currentUser`, identifier `dev.mapper.app` | L | T1.2 | `src-tauri/` |
| T1.4 | Три capability-файла (main/overlay/hud) и `antiban/acl.json` | L | T1.2 | `capabilities/` |
| T1.5 | Перенос `platform/win`: `hotkey.rs`, `focus.rs` с `OwnHwnd`/`ForeignHwnd`, `window_style.rs` (+ скругление, `KeyMenu`), `raw_input.rs` (+ `ensure_none` с отказом), `webview.rs` (`set_idle` + `harden`) | M | T1.2 | `platform/win/` |
| T1.6 | `single_instance.rs` (мьютекс + событие), `app/timers.rs` (один поток), `logging.rs` (ротация, экранирование, лимит) | M | T1.5 | `src-tauri/src/` |
| T1.7 | Окна из Rust: `BROWSER_ARGS`, классы `Mapper.*`, эффекты Mica/Acrylic/Blur, запуск по порядку eng §3 с `dialog::fatal` | M | T1.5, T1.6 | `app/windows.rs` |
| T1.8 | `hotkeys/spec.rs` (правила F1–F24) и `HotkeyService` (Apply/Probe/Suspend/Resume, откат) с фейковым `Registrar` | M | T1.5 | `hotkeys/` |
| T1.9 | Трей (только `MenuItem`), тексты RU/EN, ЛКМ — окно, ПКМ — меню | L | T1.7 | `app/tray.rs` |
| T1.10 | Guard в корне: перенос спайка + `deny.toml` (31 + новые крейты, sources, licenses, advisories) + baseline с `# audited:` | M | T1.2 | `scripts/`, `antiban/`, `deny.toml` |
| T1.11 | `checks.yml` + `pr.yml` (каркас): fmt, clippy, test, deny, svelte-check, vitest, guard | M | T1.10 | `.github/workflows/` |

**Критерии приёмки фазы 1.** `npm run tauri dev` запускает приложение без видимых окон, кроме
главного (пустая страница); вторая копия показывает первое окно и выходит; журнал содержит
версии и `raw input devices: 0`; Alt+Q/Alt+W регистрируются; `cargo test`, `clippy -D warnings`,
`cargo deny check`, `npm run guard` проходят локально; `npm run tauri build --no-bundle` +
`guard:exe` — 10 импортов baseline, манифест на месте.

## Фаза 2. Ядро замера, оверлей и HUD

- [x] Фаза 2: PASS (2026-10-25), подробности в `implement/IMPLEMENT.md` (перенос маршрута между зумами,
  T убрана, стекло легче — по проверке автора в игре).

Цель: полный сценарий в игре без главного окна: Alt+Q/Alt+W → калибровка (если нужна) → замер →
выход после отпускания клавиш → HUD с результатом. Конфиг хранит калибровки.

| ID | Задача | Сложн. | Зависит | Где |
|---|---|---|---|---|
| T2.1 | `lib/core`: `constants`, `calibration`, `measurement`, `ticks`, `error`, `mortar`, `travel`, `format` + golden-векторы + fast-check, покрытие ≥ 80 % (цель 95 %) | M | T1.1 | `src/lib/core`, `tests/golden` |
| T2.2 | `lib/core/session.ts` и `exitGate.ts`: редьюсер замера и мастера (шаги 1–4, шаг назад, «шаг N из 4»), учёт зажатых клавиш | M | T2.1 | `src/lib/core` |
| T2.3 | `config`: типы, `ConfigStore` (атомарная запись, бэкап битого, только чтение для новой схемы, миграции, `validate`), `MonitorKey` | M | T1.6 | `src-tauri/src/config` |
| T2.4 | `app/overlay`: чистая `phase::step` + исполнитель эффектов, `placement.rs` (закреплённый/под курсором, `WM_DPICHANGED`), взвод калибровки (10 мин) | H | T1.5, T1.6, T1.8, T2.3 | `app/overlay/` |
| T2.5 | Команды оверлея: `overlay_exit`, `overlay_blank`, `save_calibration`, `submit_result`, `log_line` с `expect_window`, `deny_unknown_fields`, `validate` | M | T2.3, T2.4 | `commands/` |
| T2.6 | `lib/ipc`: transport (tauri/mock), типы, валидаторы, фикстуры из Rust (`UPDATE_FIXTURES`) | M | T2.5 | `src/lib/ipc`, `src-tauri/tests` |
| T2.7 | Оверлей на Svelte: `Measure`, `Calibrate`, `ClickToStart`, слои `Grid`/`Route`, `Panel` (уезжает от курсора), живая длина, ΔH, миномёт, время, проверка «3 клетки», предупреждение 10× | H | T2.2, T2.6, T3.1 | `src/apps/overlay` |
| T2.8 | HUD на Svelte: результат и уведомления из типизированного payload на языке HUD; `app/hud.rs` (позиция, таймер 10 с, `set_idle`) | M | T2.6, T3.1 | `src/apps/hud`, `app/hud.rs` |
| T2.9 | i18n-ядро: `ru.ts` (источник), `en.ts` (типизирован), `t()`, плюралы, числа; тест полноты | L | T1.1 | `src/lib/i18n` |
| T2.10 | e2e (Playwright + mock): калибровка 1/2 → клик → клик → колесо → Enter; 3 клетки → 300/3 000 м ± N; маршрут, ПКМ; Esc только после `keyup`; переключение пресета; Ctrl+колесо, T, G; миномёт; HUD на двух языках; `deviceScaleFactor` 1/1,25/1,5 | M | T2.7, T2.8 | `tests/e2e` |

**Критерии приёмки фазы 2.** Все тесты и e2e зелёные; стенд S-1 спайка (вне репозитория) на новой
сборке: фокус ≥ 49/50, медиана ≤ 50 мс, 0 утечек кликов/колеса/клавиш; S-2: показ ≤ 100 мс, 0 сбоев;
калибровка сохраняется в конфиг и переживает перезапуск; другой монитор просит свою калибровку.

## Фаза 3. Главное окно (GUI)

- [x] Фаза 3: PASS (2026-10-26), подробности в `implement/IMPLEMENT.md` (T4.1 автозапуск и T4.4 ссылки
  и папки сделаны здесь; сетевая проверка версии T4.2 — в фазе 4).

Цель: новичок с GitHub проходит мастер и делает первый замер без README.

| ID | Задача | Сложн. | Зависит | Где |
|---|---|---|---|---|
| T3.1 | Дизайн-система «жидкое стекло»: `tokens.css`, `glass.css`, `base.css` по ux §2 (контраст AA, плотность 0,78–0,94), компоненты `GlassPanel`, `Button`, `Toggle`, `Slider`, `NumberField`, `Steps`, `StatusBadge` | M | T1.1 | `src/lib/styles`, `components` |
| T3.2 | Команды главного окна: `get_snapshot`, `update_settings`, `arm_calibration`, `reset_calibration`, `quit_app`; события `snapshot-changed`, `navigate`; `AppSnapshot` | M | T2.3, T2.5 | `commands/`, `app/snapshot.rs` |
| T3.3 | `app/main_window.rs`: крестик → трей (первый раз — диалог), показ без tao `set_focus`, `set_idle`, повтор регистрации хоткеев при показе | M | T1.7, T3.2 | `app/` |
| T3.4 | Мастер первого запуска (4 шага: как работает + язык → риск с обязательным флажком → режим экрана PUBG → настройка Alt+Q и Alt+W с «взводом» и проверкой) | H | T3.1, T3.2, T2.9 | `screens/FirstRun` |
| T3.5 | Главная: статус Alt+Q/Alt+W (масштаб для монитора, сколько метров на экране), «перенастроить», «сбросить», последний замер, статус хоткеев, блок «Если что-то не так» | M | T3.1, T3.2 | `screens/Home` |
| T3.6 | `HotkeyRecorder` + команды `set_hotkey`, `suspend_hotkeys` (пробная регистрация, «занят», конфликт near = far) | M | T1.8, T3.1 | `components`, `commands/` |
| T3.7 | Настройки: хоткеи, язык (без перезапуска), скорости (Dacia с пометкой «не проверено»), прозрачность панелей, монитор (под курсором / закреплённый), автозапуск, обновления | M | T3.6, T4.1, T4.2 | `screens/Settings` |
| T3.8 | «О программе»: версия, лицензия, ссылки (`open_link` по перечислению), «делает / не делает», риск, «not affiliated with KRAFTON», `open_log_folder` | L | T3.2, T4.4 | `screens/About` |
| T3.9 | e2e главного окна: мастер, RU → EN без перезагрузки, запись хоткея и `hotkey_busy`, сброс калибровки, закрытие в трей | M | T3.4–T3.8 | `tests/e2e` |

**Критерии приёмки фазы 3.** e2e зелёные; ручная проверка: мастер проходится за ≤ 3 минуты, первый
замер после мастера ≤ 3 с; Tab-порядок и экранный диктор в главном окне (ux §7); смена языка
мгновенная во всех трёх окнах.

## Фаза 4. Системная интеграция и полный guard

| ID | Задача | Сложн. | Зависит | Где |
|---|---|---|---|---|
| T4.1 | `autostart.rs`: HKCU Run с `--autostart`, чтение StartupApproved, самовосстановление пути, `set_autostart`; NSIS-хук удаления | M | T1.6 | `platform/win`, `nsis/` |
| T4.2 | `update/`: `ureq` + rustls, ETag, раз в сутки, ручная проверка ≤ 1/мин, semver, константа `REPO = "OWNER/mapper"`, `check_update_now`, пункт трея «Доступна версия» | M | T1.6, T3.2 | `src-tauri/src/update` |
| T4.3 | `--autostart`: старт в трей, окно только если хоткей занят; уведомление «Mapper работает в трее» | L | T4.1, T3.3 | `app/` |
| T4.4 | `shell.rs`: `open_link` (константные URL), `open_log_folder` (`explorer`) | L | T3.2 | `platform/win` |
| T4.5 | Guard: лексер Rust (комментарии/строки/raw-строки), сканер TS и компиляция `.svelte`, правила eng §7.2–7.3, проверка `dist/**/*.js`, обязательные строки и разбор `tauri.conf.json` | H | T1.10 | `scripts/guard` |
| T4.6 | Guard: четыре множества команд совпадают (`COMMANDS`, `generate_handler!`, `#[tauri::command]`, ACL), ACL ⊆ `acl.json` по окнам | M | T4.5, T3.2 | `scripts/guard` |
| T4.7 | Guard: импорты собственного объектного файла (`guard-obj`, `dumpbin /symbols`, `own-imports.txt`), `VS_VERSIONINFO`, стандартные секции PE | M | T4.5 | `scripts/guard`, `antiban/` |
| T4.8 | Самопроверка guard: `antiban/fixtures/violations/*` (15 из ревью + новые правила), `node --test scripts/guard` | M | T4.5–T4.7 | `antiban/fixtures` |
| T4.9 | Ревью безопасности по всему коду; исправить CRITICAL/HIGH | M | T4.1–T4.8 | — |

**Критерии приёмки фазы 4.** `npm run guard:all` зелёный; каждая подложенная нарушение поймана;
`cargo deny check` (bans, licenses, sources, advisories) зелёный; ревью без CRITICAL/HIGH.

## Фаза 5. Релиз и документация

| ID | Задача | Сложн. | Зависит | Где |
|---|---|---|---|---|
| T5.1 | `release.yml`: проверка версии, `checks.yml`, tauri-action@v1 (NSIS, затем portable `uploadPlainBinary`), `guard:exe`/`guard:obj` по релизному exe, `SHA256SUMS.txt`, attestations, черновик | M | T1.11, T4.7 | `.github/workflows` |
| T5.2 | Скрипты версий: `check-version.mjs`, `bump-version.mjs`, `release-notes.mjs`; CHANGELOG (Keep a Changelog) | L | T5.1 | `scripts/` |
| T5.3 | README (RU) и README.en: что это, GIF, «делает / не делает», заметная честная формулировка риска, установка (SmartScreen, SHA256, `gh attestation verify`), хоткеи, первый запуск, FAQ (админ-права, эксклюзивный fullscreen, Discord/NVIDIA, данные в `%APPDATA%`), раздел «Почему в exe есть SendInput», not affiliated with KRAFTON | M | фазы 2–4 | корень |
| T5.4 | LICENSE (MIT), CONTRIBUTING (сборка, `CARGO_TARGET_DIR`, guard, как добавить правило), SECURITY, шаблоны issue (bug, DPI, разрешение), шаблон PR | L | — | корень, `.github/` |
| T5.5 | `docs/in-game-checklist.md` (S-1…S-4, G-1…G-6, U-1…U-3, Alt+W), `docs/perf.md` (методика S-2/S-3), `docs/dependency-audit.md` | L | — | `docs/` |
| T5.6 | Локальная пробная сборка релиза: установщик + portable, guard по обоим, SHA256; замеры S-2/S-3 на финальной сборке (RAM ≤ 80 МБ с окном в трее) | M | T5.1–T5.3 | — |
| T5.7 | Проверка автором в игре по `docs/in-game-checklist.md` на релизной сборке; правки по итогам | M | T5.6 | — |

**Критерии приёмки фазы 5.** Пробная сборка даёт установщик и portable ≤ 8 МБ, guard зелёный по
обоим; README проходит правило слов; чеклист в игре пройден автором (минимум: S-1, Alt+W,
масштабы обоих зумов, HUD не мешает, PresentMon по возможности).

## Параллельность

```text
Фаза 1:  T1.1 ─► T1.2 ─► T1.3, T1.4 ─────────────────────────────┐
                    └─► T1.5 ─► T1.6 ─► T1.7 ─► T1.9               ├─► T1.11
                          └─► T1.8          T1.10 ────────────────┘
Фаза 2:  T2.1 ─► T2.2 ─┐      T2.3 ─► T2.4 ─► T2.5 ─► T2.6 ─┐
         T2.9 ─────────┼──────────────────────────────────► T2.7, T2.8 ─► T2.10
Фаза 3:  T3.1 (можно начать сразу после T1.1, параллельно с фазой 2)
Фаза 4:  T4.1, T4.2, T4.4 параллельно с фазой 3; T4.5–T4.8 параллельно с T3.x
Фаза 5:  T5.4, T5.5 — в любой момент; T5.1–T5.3, T5.6–T5.7 — в конце
```

Независимые ветки, которые можно вести одновременно: TS-ядро (T2.1–T2.2, T2.9) и Rust-конфиг
и оверлей (T2.3–T2.5); дизайн-система (T3.1) и платформа (фаза 1); системная интеграция (T4.1–T4.4)
и экраны (T3.4–T3.8); guard (T4.5–T4.8) и всё остальное.

## Проверки на каждой фазе

Перед завершением фазы: `npm run check`, `npm run test:coverage`, `npm run e2e` (с фазы 2),
`cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test`, `cargo deny check`,
`npm run guard` (с фазы 4 — `guard:all`), `npm run tauri build --no-bundle` + `guard:exe`. Ревью
кода в конце фаз 2, 3 и 4, ревью безопасности — в T4.9. Итог фазы — коммит
(с согласия автора) и запись в `rpi/mapper-overlay/implement/IMPLEMENT.md`.

## Определение готовности v1.0

- Все 20 историй pm.md с приоритетом Must выполнены и проверены критериями приёмки.
- Метрики: фокус ≤ 50 мс, показ ≤ 100 мс, CPU в простое ≤ 0,05 %, RAM рабочий набор ≤ 80 МБ с
  окном в трее, exe ≤ 8 МБ, guard — 0 нарушений, покрытие `lib/core` ≥ 80 %.
- Релизный черновик собирается в CI (на GitHub автора), README RU/EN и документы на месте.
- Чеклист в игре пройден автором на релизной сборке.

## Ответы автора (2026-10-20)

1. **О-1.** Скорость Dacia без ускорения по умолчанию — **100 км/ч** (`daciaKmh: 100`,
   `daciaVerified: false`; в eng.md §6 было 120 — действует это значение).
2. **О-6.** Проверка обновлений **включена** по умолчанию (раз в сутки, сказано в мастере и «О программе»).
3. **P-1.** **Git-репозиторий в `mapper/`, коммит в конце каждой фазы** (локально; публикует автор).
4. **О-3.** Alt+W в игре проверяется по чеклисту в фазе 5.

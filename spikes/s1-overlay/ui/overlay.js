"use strict";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const SVG_NS = "http://www.w3.org/2000/svg";
// Below the Rust-side safety timeout (1000 ms) so the UI normally finishes the exit.
const EXIT_WAIT_MS = 800;
// Grid matching: one wheel notch changes the cell size by 2 % (Shift: 0.2 %).
const STEP_COARSE = 1.02;
const STEP_FINE = 1.002;
const MIN_CELL_PX = 6;
// Error model: a click lands within ~1.5 px; after matching the grid by eye the far
// lines are off by at most ~0.5 px.
const CLICK_ERROR_PX = 1.5;
const ALIGN_ERROR_PX = 0.5;
const MIN_TICK_SPACING_PX = 6;
// Travel speeds. Sprint: pubg.wiki.gg (2020 data). Dacia without boost: a placeholder
// until it is timed in game (U-3).
const RUN_MPS = 6.3;
const DACIA_KMH = 120;
const STORAGE_PREFIX = "mapper.spike.calibration.";

const PRESETS = {
  near: { title: "ПРИБЛИЖЕНО · Alt+Q", hint: "обычно 2 — маленькие клетки (100 м)" },
  far: { title: "ОТДАЛЕНО · Alt+W", hint: "обычно 1 — большие клетки (1 км)" },
};

// Stages: "step" (which cells: 1 km or 100 m — always asked, a wrong guess is a 10x
// error) → "origin" (click an intersection) → "neighbour" (click the next intersection,
// one cell away: a coarse size) → "fine" (wheel until far lines match, Enter).
const CALIBRATION_PROMPTS = {
  step: "Какие клетки будешь совмещать?",
  origin: "Кликни на пересечение линий сетки",
  neighbour: "Кликни на соседнее пересечение (через одну клетку)",
  fine: "Колесом совмести дальние линии · Enter — готово",
};

const el = (id) => document.getElementById(id);
const root = el("root");
const grid = el("grid");
const scene = el("scene");
const debugPanel = el("debug");
const calibratePanel = el("calibrate");
const clickToStart = el("click-to-start");
const cycleBox = el("cycle");
const cycleSeq = el("cycle-seq");

// Keys currently held inside the overlay, and an exit waiting for them to be released:
// focus goes back to the game only when no key-up can still reach it.
const held = new Set();
let pendingExit = null;

// One calibration per preset: `origin` is a grid intersection, `cellPx` the on-screen
// size (CSS px) of one `cellMeters` cell, `w`/`h` the overlay size it was made for.
const calibrations = { near: null, far: null };
let draft = null;

const freshCounts = () => ({ clicks: 0, wheel: 0, keys: 0, ignored: 0 });

const state = {
  active: false,
  preset: "near",
  mode: "measure",
  focused: false,
  activation: null,
  swallowNextClick: false,
  showGrid: true,
  // Overlay size in CSS px as reported by Rust (the page may not have seen the resize yet).
  viewport: null,
  points: [],
  cursor: null,
  dh: 0,
  counts: freshCounts(),
};

// ------------------------------------------------------------------ helpers

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const twoFrames = async () => {
  await nextFrame();
  await nextFrame();
};

const vw = () => state.viewport?.w || window.innerWidth;
const vh = () => state.viewport?.h || window.innerHeight;
const segmentPx = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const formatMeters = (m) => `${Math.round(m).toLocaleString("ru-RU")} м`;
const formatPx = (px) => px.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
const cellLabel = (meters) => (meters === 1000 ? "1 км" : "100 м");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const calibration = () => calibrations[state.preset];

function formatDuration(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function wheelFactor(event) {
  // Chromium turns Shift+wheel into horizontal scrolling, so read whichever axis moved.
  const delta = event.deltaY || event.deltaX;
  if (delta === 0) return 1;
  const step = event.shiftKey ? STEP_FINE : STEP_COARSE;
  return delta < 0 ? step : 1 / step;
}

function metersPerPixel() {
  const c = calibration();
  return c ? c.cellMeters / c.cellPx : null;
}

function routePx(points) {
  let px = 0;
  for (let i = 1; i < points.length; i += 1) px += segmentPx(points[i - 1], points[i]);
  return px;
}

// Matching error shrinks with the span over which lines were compared (up to ~90 % of
// the screen width, in whole cells).
function scaleRelativeError(c) {
  const span = Math.max(c.cellPx, Math.floor((vw() * 0.9) / c.cellPx) * c.cellPx);
  return ALIGN_ERROR_PX / span;
}

function errorMeters(points) {
  const mpp = metersPerPixel();
  const segments = points.length - 1;
  const click = CLICK_ERROR_PX * Math.SQRT2 * Math.sqrt(segments) * mpp;
  return click + routePx(points) * mpp * scaleRelativeError(calibration());
}

// ------------------------------------------------------------- calibration

// A calibration belongs to one monitor size; another monitor needs its own.
const fitsViewport = (c) => Boolean(c) && Math.abs(c.w - vw()) < 1 && Math.abs(c.h - vh()) < 1 && c.cellPx > 0;

function loadCalibration(preset) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + preset) ?? "null");
    return fitsViewport(saved) ? saved : null;
  } catch {
    return null;
  }
}

function saveCalibration() {
  try {
    localStorage.setItem(STORAGE_PREFIX + state.preset, JSON.stringify(calibration()));
  } catch {
    // storage unavailable: the calibration lives for this session only
  }
}

function ensureCalibration() {
  if (!fitsViewport(calibrations[state.preset])) calibrations[state.preset] = loadCalibration(state.preset);
  return calibrations[state.preset];
}

function startCalibration() {
  draft = { stage: "step", cellMeters: null, cellPx: null, origin: null };
  state.mode = "calibrate";
  render();
}

function chooseCellStep(meters) {
  draft.cellMeters = meters;
  if (draft.stage === "step") draft.stage = "origin";
  render();
}

function commitCalibration() {
  if (draft?.stage !== "fine") return;
  calibrations[state.preset] = {
    cellMeters: draft.cellMeters,
    cellPx: draft.cellPx,
    origin: draft.origin,
    w: vw(),
    h: vh(),
  };
  draft = null;
  saveCalibration();
  state.mode = "measure";
  const c = calibration();
  invoke("log_line", {
    msg: `calibrated ${state.preset}: ${cellLabel(c.cellMeters)} = ${c.cellPx.toFixed(2)} css px, ${(c.cellMeters / c.cellPx).toFixed(4)} m/px, viewport ${c.w.toFixed(1)}x${c.h.toFixed(1)}`,
  });
  render();
}

function cancelCalibration() {
  draft = null;
  state.mode = "measure";
  if (!calibration()) requestExit("esc without calibration", false);
  render();
}

// Switches a grid between 1 km and 100 m cells while keeping the same scale (m/px).
function toggleCellStep(c) {
  if (!c?.cellMeters || !c.cellPx) return;
  const toHundred = c.cellMeters === 1000;
  c.cellMeters = toHundred ? 100 : 1000;
  c.cellPx = toHundred ? c.cellPx / 10 : c.cellPx * 10;
}

// ---------------------------------------------------------------- drawing

function svg(parent, tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent.appendChild(node);
  return node;
}

function drawGrid() {
  grid.replaceChildren();
  const calibrating = state.mode === "calibrate";
  grid.classList.toggle("calibrating", calibrating);
  const c = calibrating ? draft : state.showGrid ? calibration() : null;
  if (!c?.origin) return;
  if (calibrating && draft.stage === "neighbour" && state.cursor) {
    svg(grid, "line", { x1: c.origin.x, y1: c.origin.y, x2: state.cursor.x, y2: state.cursor.y });
  }
  if (c.cellPx >= MIN_CELL_PX && (!calibrating || draft.stage === "fine")) {
    for (let x = c.origin.x % c.cellPx; x <= vw(); x += c.cellPx) svg(grid, "line", { x1: x, y1: 0, x2: x, y2: vh() });
    for (let y = c.origin.y % c.cellPx; y <= vh(); y += c.cellPx) svg(grid, "line", { x1: 0, y1: y, x2: vw(), y2: y });
  }
  if (calibrating) svg(grid, "circle", { class: "origin", cx: c.origin.x, cy: c.origin.y, r: 7 });
}

function drawTicks(a, b, mpp) {
  const lengthPx = segmentPx(a, b);
  const tickMeters = 100 / mpp >= MIN_TICK_SPACING_PX ? 100 : 1000;
  const stepPx = tickMeters / mpp;
  if (lengthPx < 1 || stepPx < MIN_TICK_SPACING_PX) return;
  const ux = (b.x - a.x) / lengthPx;
  const uy = (b.y - a.y) / lengthPx;
  for (let i = 1; i * stepPx < lengthPx; i += 1) {
    const major = tickMeters === 1000 || i % 10 === 0;
    const half = major ? 9 : 5;
    const cx = a.x + ux * i * stepPx;
    const cy = a.y + uy * i * stepPx;
    svg(scene, "line", { class: "tick", x1: cx + uy * half, y1: cy - ux * half, x2: cx - uy * half, y2: cy + ux * half });
  }
}

function drawRoute() {
  scene.replaceChildren();
  const pts = state.points;
  const mpp = metersPerPixel();
  if (state.mode !== "measure" || pts.length === 0 || !mpp) return;
  svg(scene, "polyline", { class: "route", points: pts.map((p) => `${p.x},${p.y}`).join(" ") });
  for (let i = 1; i < pts.length; i += 1) {
    drawTicks(pts[i - 1], pts[i], mpp);
    const label = svg(scene, "text", {
      class: "seg-label",
      x: (pts[i - 1].x + pts[i].x) / 2 + 10,
      y: (pts[i - 1].y + pts[i].y) / 2 - 10,
    });
    label.textContent = formatMeters(segmentPx(pts[i - 1], pts[i]) * mpp);
  }
  if (state.cursor && state.focused) {
    const last = pts[pts.length - 1];
    svg(scene, "line", { class: "rubber", x1: last.x, y1: last.y, x2: state.cursor.x, y2: state.cursor.y });
  }
  for (const p of pts) svg(scene, "circle", { class: "point", cx: p.x, cy: p.y, r: 6 });
}

function focusText() {
  const a = state.activation;
  if (!a) return "ждём…";
  if (a.ok) return `взят за ${a.ms.toFixed(1)} мс`;
  return state.focused ? "взят кликом" : "не взят — кликни";
}

function renderCalibrationPanel() {
  el("calibrate-title").textContent = `Настройка масштаба · ${PRESETS[state.preset].title}`;
  el("calibrate-step").textContent = CALIBRATION_PROMPTS[draft.stage];
  let detail = `1 — большие клетки (1 км) · 2 — маленькие (100 м) · ${PRESETS[state.preset].hint}`;
  if (draft.cellMeters) {
    detail = draft.cellPx
      ? `клетка ${cellLabel(draft.cellMeters)} = ${formatPx(draft.cellPx)} px`
      : `клетка ${cellLabel(draft.cellMeters)}`;
  }
  el("calibrate-scale").textContent = detail;
}

function renderMeasurePanel() {
  const c = calibration();
  const mpp = metersPerPixel();
  const pts = state.points;
  el("preset-label").textContent = PRESETS[state.preset].title;
  el("scale").textContent = c ? `клетка ${cellLabel(c.cellMeters)} · ${mpp.toFixed(2)} м/px` : "не задан — C";
  el("screen-size").textContent = mpp ? `${formatMeters(vw() * mpp)} × ${formatMeters(vh() * mpp)}` : "—";
  const measured = pts.length >= 2 && mpp;
  const meters = measured ? routePx(pts) * mpp : 0;
  el("distance").textContent = measured ? `${formatMeters(meters)} ± ${Math.max(1, Math.round(errorMeters(pts)))} м` : "—";
  el("time-run").textContent = measured ? `≈ ${formatDuration(meters / RUN_MPS)} (спринт ${RUN_MPS} м/с)` : "—";
  el("time-dacia").textContent = measured
    ? `≈ ${formatDuration(meters / (DACIA_KMH / 3.6))} (${DACIA_KMH} км/ч — не проверено)`
    : "—";
  el("dh").textContent = `${signed(state.dh)} м`;
  el("focus-state").textContent = focusText();
}

function render() {
  root.classList.toggle("hidden", !state.active);
  debugPanel.classList.toggle("focused", state.focused);
  const waitingForClick = state.active && state.activation && !state.activation.ok && !state.focused;
  clickToStart.classList.toggle("hidden", !waitingForClick);
  const calibrating = state.mode === "calibrate";
  calibratePanel.classList.toggle("hidden", !calibrating);
  debugPanel.classList.toggle("hidden", calibrating);
  drawGrid();
  drawRoute();
  if (calibrating) renderCalibrationPanel();
  renderMeasurePanel();
}

// ------------------------------------------------------------ session flow

function commitExit(via) {
  const exit = pendingExit;
  if (!exit) return;
  clearTimeout(exit.timer);
  pendingExit = null;
  invoke("deactivate", { reason: via ? `${exit.reason} (${via})` : exit.reason });
}

function maybeExit() {
  if (pendingExit && held.size === 0 && (!pendingExit.needKeyUp || pendingExit.sawKeyUp)) commitExit();
}

// needKeyUp: the hotkey's own key-down never reaches us (RegisterHotKey consumes it),
// but its key-up does, so wait for at least one release before handing focus back.
function requestExit(reason, needKeyUp) {
  if (!state.active || pendingExit) return;
  pendingExit = { reason, needKeyUp, sawKeyUp: false, timer: setTimeout(() => commitExit("timeout"), EXIT_WAIT_MS) };
  maybeExit();
}

function selectPreset(preset) {
  state.preset = preset;
  draft = null;
  state.mode = "measure";
  if (ensureCalibration()) render();
  else startCalibration();
}

function startSession(payload) {
  held.clear();
  if (pendingExit) clearTimeout(pendingExit.timer);
  pendingExit = null;
  Object.assign(state, {
    active: true,
    focused: document.hasFocus(),
    activation: null,
    swallowNextClick: false,
    viewport: payload.width > 0 ? { w: payload.width, h: payload.height } : null,
    points: [],
    cursor: null,
    dh: 0,
    counts: freshCounts(),
  });
  selectPreset(payload.preset === "far" ? "far" : "near");
}

function sendResultToHud() {
  const pts = state.points;
  const mpp = metersPerPixel();
  if (pts.length < 2 || !mpp) return;
  const meters = routePx(pts) * mpp;
  const payload = {
    title: formatMeters(meters),
    lines: [
      `± ${Math.max(1, Math.round(errorMeters(pts)))} м · бегом ≈ ${formatDuration(meters / RUN_MPS)} · Dacia ≈ ${formatDuration(meters / (DACIA_KMH / 3.6))}`,
      `${PRESETS[state.preset].title} · ΔH ${signed(state.dh)} м`,
    ],
    tone: "result",
  };
  invoke("show_hud", { payload });
}

async function blankAndAck(seq) {
  if (state.active) {
    sendResultToHud();
    invoke("log_line", { msg: `session end (${state.preset}): points=${state.points.length} counts=${JSON.stringify(state.counts)}` });
  }
  state.active = false;
  state.mode = "measure";
  draft = null;
  state.points = [];
  state.cursor = null;
  cycleBox.classList.add("hidden");
  render();
  await twoFrames();
  invoke("overlay_blank", { seq });
}

// ------------------------------------------------------------ Rust events

listen("overlay-activating", (event) => startSession(event.payload));

listen("overlay-preset", (event) => selectPreset(event.payload.preset));

listen("overlay-activated", (event) => {
  state.activation = event.payload;
  if (event.payload.ok) {
    state.focused = true;
  } else {
    // The click that activates the window must not become a point.
    state.swallowNextClick = true;
  }
  render();
});

listen("overlay-focused", () => {
  state.focused = true;
  render();
});

listen("overlay-exit-request", () => requestExit("hotkey", true));

listen("overlay-blank-request", (event) => blankAndAck(event.payload.seq));

listen("cycle-show", async (event) => {
  cycleSeq.textContent = `#${event.payload.seq}`;
  cycleBox.classList.remove("hidden");
  await twoFrames();
  invoke("cycle_ack", { kind: "painted", seq: event.payload.seq });
});

listen("cycle-blank", async (event) => {
  cycleBox.classList.add("hidden");
  await twoFrames();
  invoke("cycle_ack", { kind: "blanked", seq: event.payload.seq });
});

// ------------------------------------------------------------ user input

window.addEventListener("focus", () => {
  state.focused = true;
  render();
});

window.addEventListener("blur", () => {
  state.focused = false;
  render();
});

function onCalibrationPointer(event) {
  if (event.button !== 0 || draft.stage === "step") return;
  const point = { x: event.clientX, y: event.clientY };
  if (draft.stage === "neighbour") {
    // Grid lines are axis-aligned, so the larger offset is the size of one cell.
    const cell = Math.max(Math.abs(point.x - draft.origin.x), Math.abs(point.y - draft.origin.y));
    if (cell < MIN_CELL_PX) return;
    draft.cellPx = cell;
    draft.stage = "fine";
  } else {
    draft.origin = point;
    if (draft.stage === "origin") draft.stage = "neighbour";
  }
  render();
}

function onMeasurePointer(event) {
  const c = calibration();
  if (event.button === 0) state.points.push({ x: event.clientX, y: event.clientY });
  else if (event.button === 2) state.points.pop();
  else if (event.button === 1 && c) {
    c.origin = { x: event.clientX, y: event.clientY };
    saveCalibration();
  }
  render();
}

root.addEventListener("pointerdown", (event) => {
  if (!state.active) return;
  event.preventDefault();
  if (state.swallowNextClick || !state.focused) {
    state.swallowNextClick = false;
    state.counts.ignored += 1;
    render();
    return;
  }
  state.counts.clicks += 1;
  if (state.mode === "calibrate") onCalibrationPointer(event);
  else onMeasurePointer(event);
});

// Middle button would start auto-scroll otherwise.
root.addEventListener("mousedown", (event) => {
  if (event.button === 1) event.preventDefault();
});

root.addEventListener("contextmenu", (event) => event.preventDefault());

root.addEventListener("pointermove", (event) => {
  if (!state.active) return;
  state.cursor = { x: event.clientX, y: event.clientY };
  const rubberBand = state.mode === "measure" ? state.points.length > 0 : draft?.stage === "neighbour";
  if (rubberBand) render();
});

window.addEventListener(
  "wheel",
  (event) => {
    if (!state.active) return;
    event.preventDefault();
    const factor = wheelFactor(event);
    if (factor === 1) return;
    state.counts.wheel += 1;
    const c = calibration();
    const maxCell = Math.max(vw(), vh());
    if (state.mode === "calibrate") {
      if (draft.stage !== "fine") return;
      draft.cellPx = clamp(draft.cellPx * factor, MIN_CELL_PX, maxCell);
    } else if (event.ctrlKey && c) {
      c.cellPx = clamp(c.cellPx * factor, MIN_CELL_PX, maxCell);
      saveCalibration();
    } else {
      const step = event.shiftKey ? 10 : 1;
      state.dh += factor > 1 ? step : -step;
    }
    render();
  },
  { passive: false },
);

// 1 / 2 only say what the aligned cells are; the pixel alignment itself is untouched.
function onCalibrationKey(event) {
  if (event.key === "Escape") cancelCalibration();
  else if (event.key === "Enter") commitCalibration();
  else if (event.code === "Digit1" || event.code === "Numpad1") chooseCellStep(1000);
  else if (event.code === "Digit2" || event.code === "Numpad2") chooseCellStep(100);
}

function onMeasureKey(event) {
  const c = calibration();
  if (event.key === "Escape") requestExit("esc", false);
  else if (event.code === "KeyC") startCalibration();
  else if (event.code === "KeyG") state.showGrid = !state.showGrid;
  else if (event.code === "KeyT" && c) {
    toggleCellStep(c);
    saveCalibration();
  }
  render();
}

window.addEventListener("keydown", (event) => {
  if (!state.active) return;
  held.add(event.code);
  state.counts.keys += 1;
  event.preventDefault();
  if (event.repeat) return;
  if (state.mode === "calibrate") onCalibrationKey(event);
  else onMeasureKey(event);
});

window.addEventListener("keyup", (event) => {
  if (!state.active) return;
  held.delete(event.code);
  event.preventDefault();
  if (pendingExit) {
    pendingExit.sawKeyUp = true;
    maybeExit();
  }
});

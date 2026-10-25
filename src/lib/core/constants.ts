// Public constants of the measuring core (plan/eng.md §5). Everything here is either a
// public game fact (grid, mortar range) or a property of the ruler itself.

/** A click lands within about 1.5 CSS px of where the player aimed. */
export const CLICK_ERROR_PX = 1.5;
/** After matching the grid by eye, the far lines are off by at most about 0.5 CSS px. */
export const ALIGN_ERROR_PX = 0.5;
/** Grid matching: one wheel notch changes the cell size by 2 % (Shift: 0.2 %). */
export const STEP_COARSE = 1.02;
export const STEP_FINE = 1.002;
/** Smallest cell the ruler accepts; below it the grid lines would merge. */
export const MIN_CELL_PX = 6;
/** Largest cell the config accepts (Rust validates the same range). */
export const MAX_CELL_PX = 8000;
/** Ticks closer than this are dropped (100 m ticks first, then 1 km). */
export const MIN_TICK_SPACING_PX = 6;
/** Below the Rust safety timeout (1000 ms), so the UI normally finishes the exit itself. */
export const EXIT_WAIT_MS = 800;
/** Rust rejects routes with more than 63 segments. */
export const MAX_POINTS = 64;

/** Map grid of every 8×8 map: big cells 1 km, small cells 100 m. */
export const GRID_MAJOR_M = 1000;
export const GRID_MINOR_M = 100;

/** Mortar range (Update 14.2) and the flat-ground maximum M of the trajectory model. */
export const MORTAR_MAX_M = 700;
export const MORTAR_MIN_M = 121;
/** |Δh / L| below this counts as flat ground: the sight value equals the distance. */
export const BETA_EPS = 0.001;
/** Height correction is shown as experimental if the in-game check G-2 fails. */
export const MORTAR_DH_EXPERIMENTAL = false;

/** Wheel changes the target height by 1 m (Shift: 10 m), within ±999 m. */
export const DH_STEP_M = 1;
export const DH_STEP_FAST_M = 10;
export const DH_LIMIT_M = 999;

/**
 * Probable 10× mix-up of 1 km and 100 m cells: zoomed in all the way the screen shows well
 * under 3 km of map height, zoomed out all the way well over (thresholds to confirm in game, G-1).
 */
export const TEN_X_SCREEN_HEIGHT_M = 3000;

/** The measuring panel moves to the other corner when the cursor or a point comes this close. */
export const PANEL_AVOID_PX = 32;
/** "Click to start" closes after this many seconds (Rust has the same timeout). */
export const CLICK_TO_START_S = 3;
/** Notes such as "mode switched" stay this long. */
export const NOTE_MS = 2000;
/** Calibration changes in the measuring mode (Ctrl+wheel, T, middle click) are saved after this pause. */
export const SAVE_DEBOUNCE_MS = 600;

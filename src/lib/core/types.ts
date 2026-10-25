// Shared value types of the measuring core. Coordinates are CSS px of the overlay.

export type Preset = "near" | "far";
export type Language = "ru" | "en";
export type CellMeters = 100 | 1000;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  /** Overlay size in CSS px (monitor size minus 1 px, divided by the scale factor). */
  readonly w: number;
  readonly h: number;
  /** Monitor scale factor, e.g. 1.25. */
  readonly scale: number;
}

/** One grid match: `cellPx` CSS px are `cellMeters` on the map; `origin` is an intersection. */
export interface GridScale {
  readonly cellMeters: CellMeters;
  readonly cellPx: number;
  readonly origin: Point;
}

export interface Speeds {
  readonly sprintMps: number;
  readonly daciaKmh: number;
  readonly daciaVerified: boolean;
}

export type MortarStatus = "ok" | "tooClose" | "tooFar" | "noSolution" | "notApplicable";

export interface MortarSolution {
  readonly status: MortarStatus;
  /** Value to set on the mortar sight, only when `status` is "ok". */
  readonly sightM: number | null;
}

/** What the overlay hands to Rust and the HUD shows (plan/eng.md §4). */
export interface MeasurementResult {
  readonly preset: Preset;
  readonly totalM: number;
  readonly errorM: number;
  readonly segmentsM: readonly number[];
  readonly dhM: number;
  readonly mortar: MortarSolution;
  readonly travel: { readonly sprintS: number; readonly daciaS: number; readonly daciaVerified: boolean };
}

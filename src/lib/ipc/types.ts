// IPC contract (plan/eng.md §4). Shapes are pinned by src-tauri/tests/ipc-fixtures, which
// Rust writes and the validators in ./validate.ts are tested against.

import type { CellMeters, Language, MeasurementResult, Point, Preset, Speeds } from "../core/types";

export type { MeasurementResult };

export type WindowLabel = "main" | "overlay" | "hud";

/** A saved scale as Rust keeps it: the UI-chosen grid plus the overlay it belongs to. */
export interface Calibration {
  readonly cellMeters: CellMeters;
  readonly cellPx: number;
  readonly origin: Point;
  readonly w: number;
  readonly h: number;
  readonly scale: number;
  readonly createdAt: string;
}

export interface OverlaySettings {
  readonly language: Language;
  readonly panelOpacity: number;
  readonly speeds: Speeds;
  readonly hotkeys: Readonly<Record<Preset, string>>;
}

export interface OverlayActivating {
  readonly seq: number;
  readonly preset: Preset;
  readonly start: "measure" | "calibrate";
  readonly viewport: { readonly w: number; readonly h: number; readonly scale: number };
  readonly monitor: { readonly key: string; readonly label: string };
  readonly calibrations: Readonly<Record<Preset, Calibration | null>>;
  readonly settings: OverlaySettings;
}

export interface OverlayActivated {
  readonly seq: number;
  readonly ok: boolean;
  readonly attempts: number;
  readonly ms: number;
}

export interface SeqEvent {
  readonly seq: number;
}

export interface PresetEvent {
  readonly seq: number;
  readonly preset: Preset;
}

export type BlankReason = "exit" | "focusLost" | "clickTimeout" | "quit";

export interface BlankRequest {
  readonly seq: number;
  readonly reason: BlankReason;
}

export type HudShow =
  | { readonly kind: "result"; readonly result: MeasurementResult; readonly lang: Language; readonly opacity: number }
  | {
      readonly kind: "notice";
      readonly code: "routeKept";
      /** The hotkey that continues the parked route. */
      readonly hotkey: string;
      readonly lang: Language;
      readonly opacity: number;
    };

export type { ExitReason } from "../core/exitGate";

/** The grid part of a scale the overlay saves; Rust adds monitor, size and time. */
export interface GridArgs {
  readonly cellMeters: CellMeters;
  readonly cellPx: number;
  readonly origin: Point;
}

/** Every event and its payload. */
export interface Events {
  "overlay-activating": OverlayActivating;
  "overlay-activated": OverlayActivated;
  "overlay-focused": SeqEvent;
  "overlay-preset": PresetEvent;
  "overlay-exit-request": SeqEvent;
  "overlay-blank-request": BlankRequest;
  "hud-show": HudShow;
}

export type EventName = keyof Events;

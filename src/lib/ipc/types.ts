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

// ------------------------------------------------------------------ main window

export type NoticeCode = "config-reset" | "config-newer" | "config-unreadable";

export interface HotkeyStatus {
  readonly accelerator: string;
  readonly registered: boolean;
  /** Absent while the hotkey works or is paused. */
  readonly error?: "busy";
}

export interface HotkeysState {
  readonly near: HotkeyStatus;
  readonly far: HotkeyStatus;
  /** Paused for the hotkey recorder. */
  readonly suspended: boolean;
}

export interface MonitorRef {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type MonitorMode = { readonly mode: "cursor" } | { readonly mode: "pinned"; readonly pinned: MonitorRef };

export interface Settings {
  readonly language: Language;
  readonly hotkeys: Readonly<Record<Preset, string>>;
  readonly speeds: Speeds;
  readonly panelOpacity: number;
  readonly monitor: MonitorMode;
  readonly updatesEnabled: boolean;
  readonly firstRunDone: boolean;
  readonly wizardStep: number;
  readonly riskAccepted: boolean;
  readonly trayHintShown: boolean;
  readonly uiZoom: number;
}

/** A connected monitor. */
export interface Display {
  readonly name: string;
  readonly key: string;
  readonly label: string;
  readonly primary: boolean;
  readonly pinned: boolean;
}

/** The scales of one monitor key (connected or kept from before). */
export interface MonitorScales {
  readonly key: string;
  readonly label: string;
  readonly connected: boolean;
  readonly primary: boolean;
  readonly near: Calibration | null;
  readonly far: Calibration | null;
}

export interface OverlayNow {
  readonly preset: Preset;
  readonly start: "measure" | "calibrate";
}

export interface LastMeasurement {
  readonly result: MeasurementResult;
  readonly monitorKey: string;
  /** Unix time, ms. */
  readonly at: number;
}

export interface AutostartStatus {
  readonly enabled: boolean;
  readonly approvedByWindows: boolean;
  readonly pathMatches: boolean;
}

export type UpdateState =
  | "noRepository"
  | "off"
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "offline"
  | "rateLimited"
  | "badResponse";

export interface UpdateView {
  readonly state: UpdateState;
  /** "v1.1.0", only when newer than this Mapper. */
  readonly latest: string | null;
  readonly current: string;
  /** Unix seconds of the last answer or failure. */
  readonly checkedAt: number | null;
  /** "Later" was pressed for this version. */
  readonly dismissed: boolean;
}

export interface AppSnapshot {
  /** Grows with every snapshot Rust builds: an older one never replaces a newer one. */
  readonly revision: number;
  readonly version: string;
  readonly readOnly: boolean;
  readonly notices: readonly NoticeCode[];
  readonly settings: Settings;
  readonly hotkeys: HotkeysState;
  readonly displays: readonly Display[];
  readonly scales: readonly MonitorScales[];
  readonly pinnedMissing: boolean;
  readonly armed: Preset | null;
  readonly overlay: OverlayNow | null;
  readonly lastMeasurement: LastMeasurement | null;
  readonly autostart: AutostartStatus;
  readonly update: UpdateView;
}

/** `update_settings`: only the named fields change (Rust refuses unknown ones). */
export interface SettingsPatch {
  readonly language?: Language;
  readonly sprintMps?: number;
  readonly daciaKmh?: number;
  readonly resetSpeeds?: true;
  readonly panelOpacity?: number;
  readonly monitor?: { readonly mode: "cursor" } | { readonly mode: "pinned"; readonly name: string };
  readonly updatesEnabled?: boolean;
  readonly firstRunDone?: boolean;
  readonly wizardStep?: number;
  readonly riskAccepted?: boolean;
  readonly uiZoom?: number;
  /** "Later" on the banner, with the version it showed (`v1.1.0`). */
  readonly dismissUpdate?: string;
}

export type Link = "repo" | "releases" | "issues" | "license" | "security" | "risk";
export type Folder = "config" | "logs";
export type ResetTarget = Preset | "both";

/** Every event and its payload. */
export interface Events {
  "overlay-activating": OverlayActivating;
  "overlay-activated": OverlayActivated;
  "overlay-focused": SeqEvent;
  "overlay-preset": PresetEvent;
  "overlay-exit-request": SeqEvent;
  "overlay-blank-request": BlankRequest;
  "hud-show": HudShow;
  "snapshot-changed": AppSnapshot;
  /** The first close of the main window: show the tray dialog instead of hiding. */
  "tray-hint": Record<string, never>;
}

export type EventName = keyof Events;

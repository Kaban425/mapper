// Shape checks for what arrives from Rust. Rust is trusted, but a payload that does not
// match is a bug worth catching before it turns into NaN on screen.

import type { EventName, Events } from "./types";

type Guard<T> = (value: unknown) => value is T;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isSeq = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isString = (v: unknown, max = 256): v is string => typeof v === "string" && v.length <= max;
const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as string[]).includes(v);

const isPreset = oneOf("near", "far");
const isLanguage = oneOf("ru", "en");
const isPoint = (v: unknown) => isObject(v) && isNumber(v.x) && isNumber(v.y);

function isCalibration(v: unknown): boolean {
  return (
    isObject(v) &&
    (v.cellMeters === 100 || v.cellMeters === 1000) &&
    isNumber(v.cellPx) &&
    v.cellPx > 0 &&
    isPoint(v.origin) &&
    isNumber(v.w) &&
    isNumber(v.h) &&
    isNumber(v.scale) &&
    isString(v.createdAt, 40)
  );
}

const isSpeeds = (v: unknown) => isObject(v) && isNumber(v.sprintMps) && isNumber(v.daciaKmh) && isBool(v.daciaVerified);

function isSettings(v: unknown): boolean {
  return (
    isObject(v) &&
    isLanguage(v.language) &&
    isNumber(v.panelOpacity) &&
    isSpeeds(v.speeds) &&
    isObject(v.hotkeys) &&
    isString(v.hotkeys.near, 32) &&
    isString(v.hotkeys.far, 32)
  );
}

function isActivating(v: unknown): boolean {
  if (!isObject(v) || !isObject(v.viewport) || !isObject(v.monitor) || !isObject(v.calibrations)) return false;
  const { viewport, monitor, calibrations } = v;
  return (
    isSeq(v.seq) &&
    isPreset(v.preset) &&
    oneOf("measure", "calibrate")(v.start) &&
    isNumber(viewport.w) &&
    viewport.w > 0 &&
    isNumber(viewport.h) &&
    viewport.h > 0 &&
    isNumber(viewport.scale) &&
    viewport.scale > 0 &&
    isString(monitor.key, 32) &&
    isString(monitor.label, 64) &&
    (calibrations.near === null || isCalibration(calibrations.near)) &&
    (calibrations.far === null || isCalibration(calibrations.far)) &&
    isSettings(v.settings)
  );
}

const isMortarStatus = oneOf("ok", "tooClose", "tooFar", "noSolution", "notApplicable");

export function isMeasurementResult(v: unknown): boolean {
  return (
    isObject(v) &&
    isPreset(v.preset) &&
    isNumber(v.totalM) &&
    isNumber(v.errorM) &&
    Array.isArray(v.segmentsM) &&
    v.segmentsM.length <= 63 &&
    v.segmentsM.every(isNumber) &&
    isNumber(v.dhM) &&
    isObject(v.mortar) &&
    isMortarStatus(v.mortar.status) &&
    (v.mortar.sightM === null || isNumber(v.mortar.sightM)) &&
    isObject(v.travel) &&
    isNumber(v.travel.sprintS) &&
    isNumber(v.travel.daciaS) &&
    isBool(v.travel.daciaVerified)
  );
}

const isSeqEvent = (v: unknown) => isObject(v) && isSeq(v.seq);

const isNullable = (check: (v: unknown) => boolean) => (v: unknown) => v === null || check(v);
const isArrayOf = (check: (v: unknown) => boolean, max: number) => (v: unknown) =>
  Array.isArray(v) && v.length <= max && v.every(check);

const isHotkeyStatus = (v: unknown) =>
  isObject(v) && isString(v.accelerator, 32) && isBool(v.registered) && (v.error === undefined || v.error === "busy");

const isMonitorMode = (v: unknown) =>
  isObject(v) &&
  (v.mode === "cursor" ||
    (v.mode === "pinned" &&
      isObject(v.pinned) &&
      isString(v.pinned.name, 64) &&
      [v.pinned.x, v.pinned.y, v.pinned.w, v.pinned.h].every(Number.isSafeInteger)));

function isMainSettings(v: unknown): boolean {
  return (
    isSettings(v) &&
    isObject(v) &&
    isMonitorMode(v.monitor) &&
    isBool(v.updatesEnabled) &&
    isBool(v.firstRunDone) &&
    Number.isSafeInteger(v.wizardStep) &&
    isBool(v.riskAccepted) &&
    isBool(v.trayHintShown) &&
    isNumber(v.uiZoom)
  );
}

const isDisplay = (v: unknown) =>
  isObject(v) && isString(v.name, 64) && isString(v.key, 32) && isString(v.label, 64) && isBool(v.primary) && isBool(v.pinned);

const isMonitorScales = (v: unknown) =>
  isObject(v) &&
  isString(v.key, 32) &&
  isString(v.label, 64) &&
  isBool(v.connected) &&
  isBool(v.primary) &&
  isNullable(isCalibration)(v.near) &&
  isNullable(isCalibration)(v.far);

const isOverlayNow = (v: unknown) => isObject(v) && isPreset(v.preset) && oneOf("measure", "calibrate")(v.start);

const isLastMeasurement = (v: unknown) =>
  isObject(v) && isMeasurementResult(v.result) && isString(v.monitorKey, 32) && isSeq(v.at);

const isAutostart = (v: unknown) =>
  isObject(v) && isBool(v.enabled) && isBool(v.approvedByWindows) && isBool(v.pathMatches);

export function isAppSnapshot(v: unknown): boolean {
  return (
    isObject(v) &&
    isSeq(v.revision) &&
    isString(v.version, 32) &&
    isBool(v.readOnly) &&
    isArrayOf(oneOf("config-reset", "config-newer", "config-unreadable"), 8)(v.notices) &&
    isMainSettings(v.settings) &&
    isObject(v.hotkeys) &&
    isHotkeyStatus(v.hotkeys.near) &&
    isHotkeyStatus(v.hotkeys.far) &&
    isBool(v.hotkeys.suspended) &&
    isArrayOf(isDisplay, 32)(v.displays) &&
    isArrayOf(isMonitorScales, 64)(v.scales) &&
    isBool(v.pinnedMissing) &&
    isNullable(isPreset)(v.armed) &&
    isNullable(isOverlayNow)(v.overlay) &&
    isNullable(isLastMeasurement)(v.lastMeasurement) &&
    isAutostart(v.autostart)
  );
}

export const guards: { readonly [K in EventName]: Guard<Events[K]> } = {
  "overlay-activating": isActivating as Guard<Events["overlay-activating"]>,
  "overlay-activated": ((v: unknown) =>
    isObject(v) && isSeq(v.seq) && isBool(v.ok) && isSeq(v.attempts) && isNumber(v.ms)) as Guard<Events["overlay-activated"]>,
  "overlay-focused": isSeqEvent as Guard<Events["overlay-focused"]>,
  "overlay-preset": ((v: unknown) => isSeqEvent(v) && isPreset((v as Record<string, unknown>).preset)) as Guard<
    Events["overlay-preset"]
  >,
  "overlay-exit-request": isSeqEvent as Guard<Events["overlay-exit-request"]>,
  "overlay-blank-request": ((v: unknown) =>
    isSeqEvent(v) && oneOf("exit", "focusLost", "clickTimeout", "quit")((v as Record<string, unknown>).reason)) as Guard<
    Events["overlay-blank-request"]
  >,
  "hud-show": ((v: unknown) =>
    isObject(v) &&
    isLanguage(v.lang) &&
    isNumber(v.opacity) &&
    ((v.kind === "result" && isMeasurementResult(v.result)) ||
      (v.kind === "notice" && v.code === "routeKept" && isString(v.hotkey, 32)))) as Guard<Events["hud-show"]>,
  "snapshot-changed": isAppSnapshot as Guard<Events["snapshot-changed"]>,
  "tray-hint": ((v: unknown) => isObject(v) && Object.keys(v).length === 0) as Guard<Events["tray-hint"]>,
};

// The main window's state: the snapshot Rust holds, the open screen and the dialogs. Every
// change goes through a command that answers with the new snapshot, so the window never shows
// a value Rust did not accept. A hidden window gets no events; it asks again when shown.

import type { Language, Preset } from "../../lib/core/types";
import type { MainKey } from "../../lib/i18n/main";
import {
  armCalibration,
  describeError,
  getSnapshot,
  hideMainWindow,
  logFailure,
  openFolder,
  openLink,
  quitApp,
  resetCalibration,
  resetHotkeys,
  setAutostart,
  setHotkey,
  suspendHotkeys,
  updateSettings,
  type IpcErrorCode,
} from "../../lib/ipc/commands";
import { on } from "../../lib/ipc/events";
import type { AppSnapshot, Folder, Link, ResetTarget, SettingsPatch } from "../../lib/ipc/types";
import { isAppSnapshot } from "../../lib/ipc/validate";

export type Screen = "home" | "settings" | "about";

const LABEL = "main";

/** The message for a refusal that is not about one field. */
export function errorKey(code: string): MainKey {
  if (code === "read_only") return "error.read_only";
  if (code === "io") return "error.io";
  if (code === "path_too_long") return "error.path_too_long";
  return "error.generic";
}

export class MainStore {
  snapshot = $state.raw<AppSnapshot | null>(null);
  screen = $state<Screen>("home");
  /** Set by the first close: the tray dialog is open. */
  trayHint = $state(false);
  /** The last failed change, in words; cleared by the next success. */
  error = $state<MainKey | null>(null);
  /** Asked from Home ("choose another combination"): Settings focuses that recorder. */
  focusHotkey = $state<Preset | null>(null);

  get lang(): Language {
    return this.snapshot?.settings.language ?? "ru";
  }

  async connect(): Promise<void> {
    const invalid = (event: string) => void logFailure("event", `${event}: unexpected payload`);
    try {
      await Promise.all([
        on("snapshot-changed", LABEL, (s) => this.accept(s), invalid),
        on("tray-hint", LABEL, () => (this.trayHint = true), invalid),
      ]);
    } catch (error) {
      // Without events the window still works from command answers.
      await logFailure("listen", error);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.reload();
    });
    await this.reload();
  }

  async reload(): Promise<void> {
    try {
      this.accept(await getSnapshot());
    } catch (error) {
      await logFailure("get_snapshot", error);
    }
  }

  /** A command answer and an event can cross: only a newer, well-formed snapshot is shown. */
  private accept(next: unknown): void {
    if (!isAppSnapshot(next)) {
      void logFailure("snapshot", "unexpected shape");
      return;
    }
    const snapshot = next as AppSnapshot;
    if (this.snapshot && snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot;
  }

  /** Runs a change; on refusal returns its code (callers show field errors) and keeps the old state. */
  private async change(action: string, command: () => Promise<AppSnapshot>): Promise<IpcErrorCode | null> {
    try {
      this.accept(await command());
      this.error = null;
      return null;
    } catch (error) {
      const code = describeError(error) as IpcErrorCode;
      if (!code.startsWith("hotkey_") && code !== "invalid_input") this.error = errorKey(code);
      void logFailure(action, error);
      return code;
    }
  }

  update(patch: SettingsPatch): Promise<IpcErrorCode | null> {
    return this.change("update_settings", () => updateSettings(patch));
  }

  setHotkey(preset: Preset, accelerator: string): Promise<IpcErrorCode | null> {
    return this.change("set_hotkey", () => setHotkey(preset, accelerator));
  }

  resetHotkeys(): Promise<IpcErrorCode | null> {
    return this.change("reset_hotkeys", () => resetHotkeys());
  }

  suspendHotkeys(suspended: boolean): Promise<IpcErrorCode | null> {
    return this.change("suspend_hotkeys", () => suspendHotkeys(suspended));
  }

  arm(preset: Preset | null): Promise<IpcErrorCode | null> {
    return this.change("arm_calibration", () => armCalibration(preset));
  }

  reset(monitorKey: string, preset: ResetTarget): Promise<IpcErrorCode | null> {
    return this.change("reset_calibration", () => resetCalibration(monitorKey, preset));
  }

  setAutostart(enabled: boolean): Promise<IpcErrorCode | null> {
    return this.change("set_autostart", () => setAutostart(enabled));
  }

  async open(link: Link): Promise<void> {
    await openLink(link).catch((e) => this.fail("open_link", e));
  }

  async openFolder(folder: Folder): Promise<void> {
    await openFolder(folder).catch((e) => this.fail("open_folder", e));
  }

  /** "Got it" in the tray dialog. */
  async hideToTray(): Promise<void> {
    this.trayHint = false;
    await hideMainWindow().catch((e) => this.fail("hide_main_window", e));
  }

  async quit(): Promise<void> {
    await quitApp().catch((e) => this.fail("quit_app", e));
  }

  private fail(action: string, error: unknown): Promise<void> {
    this.error = "error.generic";
    return logFailure(action, error);
  }
}

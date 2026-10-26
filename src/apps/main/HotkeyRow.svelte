<script lang="ts">
  // One hotkey with its recorder (plan/ux.md M-6a, §6.4). "Change" pauses both hotkeys, the
  // next combination is checked here, then by a test RegisterHotKey in Rust; Esc or Tab
  // cancel. Leaving the window also ends the pause on the Rust side.
  import { tick } from "svelte";

  import Button from "../../lib/components/Button.svelte";
  import StatusBadge from "../../lib/components/StatusBadge.svelte";
  import type { Preset } from "../../lib/core/types";
  import { tm, type MainKey } from "../../lib/i18n/main";
  import type { AppSnapshot } from "../../lib/ipc/types";
  import { presetName } from "../../lib/view/result";
  import { record } from "./recorder";
  import type { MainStore } from "./store.svelte";

  let { store, snapshot, preset, label }: { store: MainStore; snapshot: AppSnapshot; preset: Preset; label: string } =
    $props();

  type Phase =
    | { readonly kind: "idle" }
    | { readonly kind: "recording"; readonly shown: string; readonly problem: MainKey | null }
    | { readonly kind: "checking"; readonly shown: string };

  const id = $props.id();
  const lang = $derived(snapshot.settings.language);
  const status = $derived(snapshot.hotkeys[preset]);
  const otherPreset = $derived<Preset>(preset === "near" ? "far" : "near");
  const other = $derived(snapshot.settings.hotkeys[otherPreset]);

  let phase = $state<Phase>({ kind: "idle" });
  let saved = $state<string | null>(null);
  let capture: HTMLInputElement | undefined = $state();
  let change: HTMLButtonElement | undefined = $state();

  // The hotkeys came back on their own (30 s, the window lost focus): recording is over, and
  // the status must not keep saying they are paused.
  $effect(() => {
    if (phase.kind !== "idle" && !snapshot.hotkeys.suspended) phase = { kind: "idle" };
  });

  // "Choose another combination" on Home lands here.
  $effect(() => {
    if (store.focusHotkey !== preset || !change) return;
    store.focusHotkey = null;
    change.focus();
  });

  async function start(): Promise<void> {
    saved = null;
    if ((await store.suspendHotkeys(true)) !== null) return;
    phase = { kind: "recording", shown: "", problem: null };
    await tick();
    capture?.focus();
  }

  async function stop(focusBack: boolean): Promise<void> {
    if (phase.kind === "idle") return;
    phase = { kind: "idle" };
    await store.suspendHotkeys(false);
    if (focusBack) change?.focus();
  }

  const REFUSALS: Readonly<Record<string, MainKey>> = {
    hotkey_busy: "settings.hotkey.busy",
    hotkey_conflict: "settings.hotkey.duplicate",
    hotkey_invalid: "settings.hotkey.key",
  };

  async function submit(accelerator: string): Promise<void> {
    phase = { kind: "checking", shown: accelerator };
    const code = await store.setHotkey(preset, accelerator);
    if (code === null) {
      saved = accelerator;
      await stop(true);
      return;
    }
    const refusal = REFUSALS[code];
    if (!refusal) {
      await stop(true);
      return;
    }
    phase = { kind: "recording", shown: accelerator, problem: refusal };
    await tick();
    capture?.focus();
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === "Tab") {
      void stop(false); // the focus moves on: no trap
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (phase.kind !== "recording" || event.repeat) return;
    if (event.key === "Escape") {
      void stop(true);
      return;
    }
    const result = record(event, other);
    if (result.kind === "modifiers") {
      phase = { kind: "recording", shown: result.preview, problem: null };
    } else if (result.problem) {
      phase = { kind: "recording", shown: result.accelerator, problem: result.problem };
    } else {
      void submit(result.accelerator);
    }
  }

  const problemText = (key: MainKey, shown: string) =>
    tm(lang, key, { hotkey: shown, preset: presetName(lang, otherPreset) });
</script>

<div class="hotkey">
  <div class="line">
    <span class="label" id="{id}-label">{label}</span>
    {#if phase.kind === "idle"}
      <kbd class="hotkey num">{status.accelerator}</kbd>
      <Button
        bind:ref={change}
        aria-label={tm(lang, "settings.hotkey.changeLabel", { mode: label, hotkey: status.accelerator })}
        onclick={start}>{tm(lang, "settings.hotkey.change")}</Button
      >
    {:else}
      <input
        bind:this={capture}
        class="capture num"
        readonly
        value={phase.shown}
        placeholder={tm(lang, "settings.hotkey.record")}
        aria-labelledby="{id}-label"
        aria-describedby="{id}-state"
        {onkeydown}
        onblur={() => phase.kind === "recording" && void stop(false)}
      />
    {/if}
  </div>
  <div class="state" id="{id}-state">
    {#if phase.kind === "recording"}
      {#if phase.problem}
        <StatusBadge kind="warn" alert>{problemText(phase.problem, phase.shown)}</StatusBadge>
      {:else}
        <p class="muted" role="status">
          {tm(lang, "settings.hotkey.paused", { near: snapshot.settings.hotkeys.near, far: snapshot.settings.hotkeys.far })}
        </p>
      {/if}
    {:else if phase.kind === "checking"}
      <p class="muted" role="status">{tm(lang, "settings.hotkey.checking")}</p>
    {:else if saved && !status.error}
      <StatusBadge kind="ok">{tm(lang, "settings.hotkey.free", { hotkey: saved })}</StatusBadge>
    {:else if status.error === "busy"}
      <StatusBadge kind="warn" alert>{tm(lang, "hotkey.busy", { hotkey: status.accelerator })}</StatusBadge>
    {:else if snapshot.hotkeys.suspended}
      <p class="muted" role="status">{tm(lang, "hotkey.paused")}</p>
    {:else}
      <StatusBadge kind="ok">{tm(lang, "hotkey.ok")}</StatusBadge>
    {/if}
  </div>
</div>

<style>
  .hotkey {
    display: grid;
    gap: 6px;
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .label {
    flex: 0 1 220px;
    min-width: 0;
  }

  .capture {
    width: 260px;
    max-width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.3);
    color: var(--accent-text);
    font-size: 14px;
  }

  .capture::placeholder {
    color: var(--text-3);
  }

  .state {
    min-height: 20px;
  }
</style>

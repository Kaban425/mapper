<script lang="ts">
  // One zoom on Home (plan/ux.md M-5): is its scale set for this monitor, what fits on the
  // screen, does the hotkey work. "Recalibrate" arms the next press of the hotkey.
  import Button from "../../lib/components/Button.svelte";
  import StatusBadge from "../../lib/components/StatusBadge.svelte";
  import type { Preset } from "../../lib/core/types";
  import { tm } from "../../lib/i18n/main";
  import type { AppSnapshot } from "../../lib/ipc/types";
  import { presetName } from "../../lib/view/result";
  import type { MainStore } from "./store.svelte";
  import { cardState, cellText, visibleText } from "./view";

  let {
    store,
    snapshot,
    preset,
    monitorKey,
    monitorLabel,
    onreset,
  }: {
    store: MainStore;
    snapshot: AppSnapshot;
    preset: Preset;
    monitorKey: string | null;
    monitorLabel: string;
    onreset: () => void;
  } = $props();

  const lang = $derived(snapshot.settings.language);
  const hotkey = $derived(snapshot.settings.hotkeys[preset]);
  const status = $derived(snapshot.hotkeys[preset]);
  const state = $derived(cardState(snapshot, monitorKey, preset));

  function pickAnother(): void {
    store.focusHotkey = preset;
    store.screen = "settings";
  }
</script>

<section class="card" aria-labelledby="card-{preset}">
  <h2 id="card-{preset}"><kbd class="hotkey num">{hotkey}</kbd> <span class="kicker-preset">{presetName(lang, preset)}</span></h2>

  {#if state.kind === "armed"}
    <StatusBadge kind="wait">{tm(lang, "home.armed", { hotkey })}</StatusBadge>
    <div class="row"><Button onclick={() => store.arm(null)}>{tm(lang, "home.cancel")}</Button></div>
  {:else if state.kind === "ready"}
    <StatusBadge kind="ok">{tm(lang, "home.ready")}</StatusBadge>
    <p class="text">{cellText(lang, state.calibration)}</p>
    <p class="text">{visibleText(lang, state.calibration)}</p>
    {#if state.tenX}<StatusBadge kind="warn">{tm(lang, "status.tenX")}</StatusBadge>{/if}
    <div class="row">
      <Button onclick={() => store.arm(preset)}>{tm(lang, "home.recalibrate")}</Button>
      <Button variant="ghost" onclick={onreset}>{tm(lang, "home.reset")}</Button>
    </div>
  {:else}
    <StatusBadge kind="warn">{tm(lang, "status.notSet")}</StatusBadge>
    <p class="text">{tm(lang, preset === "near" ? "home.notSet.near" : "home.notSet.far", { hotkey })}</p>
    {#if state.kept}
      <p class="muted">{tm(lang, "status.otherMonitor", { monitor: monitorLabel, kept: state.kept })}</p>
    {/if}
    <div class="row"><Button onclick={() => store.arm(preset)}>{tm(lang, "home.setup")}</Button></div>
  {/if}

  <hr />
  {#if status.error === "busy"}
    <StatusBadge kind="warn" alert>{tm(lang, "hotkey.busy", { hotkey })}</StatusBadge>
    <div class="row">
      <Button onclick={pickAnother}>{tm(lang, "hotkey.pick")}</Button>
      <Button variant="ghost" onclick={() => store.suspendHotkeys(false)}>{tm(lang, "hotkey.retry")}</Button>
    </div>
  {:else if snapshot.hotkeys.suspended}
    <p class="muted" role="status">{tm(lang, "hotkey.paused")}</p>
  {:else}
    <StatusBadge kind="ok">{tm(lang, "hotkey.ok")}</StatusBadge>
  {/if}
</section>

<style>
  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  hr {
    width: 100%;
    margin: 4px 0;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
</style>

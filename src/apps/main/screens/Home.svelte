<script lang="ts">
  // Home (plan/ux.md M-5): ready to measure? Both zooms for the chosen monitor, the last
  // measurement (memory only), and what to try when something is off.
  import Button from "../../../lib/components/Button.svelte";
  import Dialog from "../../../lib/components/Dialog.svelte";
  import type { Preset } from "../../../lib/core/types";
  import { tm } from "../../../lib/i18n/main";
  import type { AppSnapshot } from "../../../lib/ipc/types";
  import { presetName } from "../../../lib/view/result";
  import PresetCard from "../PresetCard.svelte";
  import type { MainStore } from "../store.svelte";
  import { defaultMonitorKey, lastLines, monitorOption, PRESETS, scalesFor, updateOffered } from "../view";

  let { store, snapshot }: { store: MainStore; snapshot: AppSnapshot } = $props();

  const lang = $derived(snapshot.settings.language);
  const hotkeys = $derived(snapshot.settings.hotkeys);
  let chosen = $state<string | null>(null);
  // A chosen monitor that is no longer listed falls back to the default one.
  const monitorKey = $derived(chosen !== null && scalesFor(snapshot, chosen) ? chosen : defaultMonitorKey(snapshot));
  const monitor = $derived(scalesFor(snapshot, monitorKey));
  const pinnedKey = $derived(snapshot.displays.find((d) => d.pinned)?.key ?? null);
  const last = $derived(snapshot.lastMeasurement ? lastLines(lang, snapshot.lastMeasurement) : null);
  let resetting = $state<Preset | null>(null);
  const offered = $derived(updateOffered(snapshot.update));
  // "Later" puts off this version only: one found meanwhile is still offered.
  const offeredTag = $derived(snapshot.update.latest);

  async function confirmReset(): Promise<void> {
    const preset = resetting;
    resetting = null;
    if (preset && monitorKey) await store.reset(monitorKey, preset);
  }

  const troubles = $derived([
    { title: tm(lang, "trouble.noHotkey", { hotkey: hotkeys.near }), body: tm(lang, "trouble.noHotkey.body", { hotkey: hotkeys.near }) },
    { title: tm(lang, "trouble.invisible", { hotkey: hotkeys.near }), body: tm(lang, "trouble.invisible.body") },
    { title: tm(lang, "trouble.grid"), body: tm(lang, "trouble.grid.body", { near: hotkeys.near, far: hotkeys.far }) },
    { title: tm(lang, "trouble.tenX"), body: tm(lang, "trouble.tenX.body") },
  ]);
</script>

<div class="screen">
  <h1 tabindex="-1">{tm(lang, "home.title")}</h1>

  {#if offered}
    <section class="banner info" aria-labelledby="update-banner">
      <span id="update-banner" role="status">{tm(lang, "update.banner", { v: offered, cur: snapshot.update.current })}</span>
      <span class="actions">
        <Button onclick={() => store.open("releases")}>{tm(lang, "update.open")}</Button>
        <Button variant="ghost" onclick={() => offeredTag && store.update({ dismissUpdate: offeredTag })}>{tm(lang, "update.later")}</Button>
      </span>
    </section>
  {/if}

  {#each snapshot.notices as notice (notice)}
    <p class="banner warn" role="status">{tm(lang, `notice.${notice}`)}</p>
  {/each}
  {#if snapshot.pinnedMissing}<p class="banner warn" role="status">{tm(lang, "home.pinnedMissing")}</p>{/if}

  {#if snapshot.scales.length > 1}
    <div class="row">
      <label for="home-monitor">{tm(lang, "home.monitor")}</label>
      <select id="home-monitor" value={monitorKey} onchange={(e) => (chosen = e.currentTarget.value)}>
        {#each snapshot.scales as m (m.key)}<option value={m.key}>{monitorOption(lang, m, m.key === pinnedKey)}</option>{/each}
      </select>
    </div>
  {:else if monitor}
    <p class="muted">{tm(lang, "home.monitor")}: {monitorOption(lang, monitor, monitor.key === pinnedKey)}</p>
  {/if}

  <div class="cards">
    {#each PRESETS as preset (preset)}
      <PresetCard {store} {snapshot} {preset} {monitorKey} monitorLabel={monitor?.label ?? ""} onreset={() => (resetting = preset)} />
    {/each}
  </div>

  <section class="last" aria-labelledby="last-title" aria-live="polite">
    <h2 id="last-title">{tm(lang, "home.last.title")}{#if last}{" · "}<span class="meta">{last.meta}</span>{/if}</h2>
    {#if last}
      <p class="distance" aria-label={last.spoken}>
        <span class="value num">{last.value}</span>
        <span class="text">{last.error}{#if last.segments}{" · "}{last.segments}{/if}</span>
      </p>
      <p class="text">{last.travel} · <span class:warn={last.mortarWarn}>{last.mortar}</span></p>
    {:else}
      <p class="muted">{tm(lang, "home.last.empty", { hotkey: hotkeys.near })}</p>
    {/if}
  </section>

  <section aria-labelledby="trouble-title">
    <h2 id="trouble-title">{tm(lang, "trouble.title")}</h2>
    {#each troubles as trouble (trouble.title)}
      <details>
        <summary>{trouble.title}</summary>
        <p>{trouble.body}</p>
      </details>
    {/each}
  </section>
</div>

{#if resetting}
  <Dialog title={tm(lang, "dialog.reset.title", { preset: presetName(lang, resetting) })} oncancel={() => (resetting = null)}>
    <p>{tm(lang, "dialog.reset.body", { monitor: monitor?.label ?? "" })}</p>
    {#snippet actions()}
      <Button data-focus onclick={() => (resetting = null)}>{tm(lang, "dialog.cancel")}</Button>
      <Button variant="danger" onclick={confirmReset}>{tm(lang, "home.reset")}</Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .info {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    margin: 0;
    border-color: rgba(255, 197, 61, 0.35);
  }

  .info .actions {
    display: flex;
    gap: 8px;
  }

  select {
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--glass-edge);
    border-radius: var(--r-sm);
    background: #1a1d22;
    color: var(--text);
    font: inherit;
  }

  .last {
    display: grid;
    gap: 6px;
  }

  .meta {
    color: var(--text-3);
    font-weight: 400;
  }

  .distance {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    margin: 0;
  }

  .value {
    color: var(--accent);
    font: 600 22px/28px var(--font-num);
  }

  .warn {
    color: var(--warn);
  }
</style>

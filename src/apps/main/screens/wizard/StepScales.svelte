<script lang="ts">
  // Wizard step 4 (plan/ux.md M-4): both rulers set up in game. The card statuses follow the
  // overlay through `snapshot-changed` while the player is in game; a busy hotkey can be
  // changed right here.
  import StatusBadge from "../../../../lib/components/StatusBadge.svelte";
  import { formatMeters } from "../../../../lib/core/format";
  import type { Preset } from "../../../../lib/core/types";
  import { tm } from "../../../../lib/i18n/main";
  import type { AppSnapshot } from "../../../../lib/ipc/types";
  import { presetName } from "../../../../lib/view/result";
  import HotkeyRow from "../../HotkeyRow.svelte";
  import type { MainStore } from "../../store.svelte";
  import { PRESETS, visibleText, wizardStatus } from "../../view";

  let {
    store,
    snapshot,
    heading = $bindable(),
  }: { store: MainStore; snapshot: AppSnapshot; heading?: HTMLHeadingElement | undefined } = $props();

  const lang = $derived(snapshot.settings.language);
  let cardHeadings = $state<Record<Preset, HTMLElement | undefined>>({ near: undefined, far: undefined });
  let wasBusy: Record<Preset, boolean> = { near: false, far: false };

  // A busy hotkey fixed right here: its recorder goes away, the reader lands on the card again.
  $effect(() => {
    const busy = { near: wizardStatus(snapshot, "near").kind === "busy", far: wizardStatus(snapshot, "far").kind === "busy" };
    for (const preset of PRESETS) {
      if (wasBusy[preset] && !busy[preset] && document.activeElement === document.body) cardHeadings[preset]?.focus();
    }
    wasBusy = busy;
  });
  const steps = (preset: Preset, hotkey: string) => [
    tm(lang, preset === "near" ? "wizard.scale.near.zoom" : "wizard.scale.far.zoom"),
    tm(lang, "wizard.scale.press", { hotkey }),
    tm(lang, preset === "near" ? "wizard.scale.near.cells" : "wizard.scale.far.cells"),
    tm(lang, "wizard.scale.click"),
    tm(lang, "wizard.scale.wheel"),
  ];
</script>

<h1 bind:this={heading} tabindex="-1">{tm(lang, "wizard.scale.title")}</h1>
<p class="text lead">{tm(lang, "wizard.scale.lead")}</p>

<div class="cards">
  {#each PRESETS as preset (preset)}
    {@const hotkey = snapshot.settings.hotkeys[preset]}
    {@const status = wizardStatus(snapshot, preset)}
    <section class="card" aria-labelledby="scale-{preset}">
      <h2 id="scale-{preset}" tabindex="-1" bind:this={cardHeadings[preset]}>
        <kbd class="hotkey num">{hotkey}</kbd> <span class="kicker-preset">{presetName(lang, preset)}</span>
      </h2>
      <ol>
        {#each steps(preset, hotkey) as text (text)}<li>{text}</li>{/each}
      </ol>
      <p class="muted">{tm(lang, "wizard.scale.check", { m: formatMeters(preset === "near" ? 300 : 3000, lang) })}</p>
      <hr />
      {#if status.kind === "ready"}
        <StatusBadge kind="ok">{tm(lang, "status.ready", { monitor: status.label })}</StatusBadge>
        <p class="muted">{visibleText(lang, status.calibration)}</p>
        {#if status.tenX}<StatusBadge kind="warn">{tm(lang, "status.tenX")}</StatusBadge>{/if}
      {:else if status.kind === "calibrating"}
        <StatusBadge kind="wait">{tm(lang, "status.calibrating", { hotkey })}</StatusBadge>
      {:else if status.kind === "busy"}
        <HotkeyRow {store} {snapshot} {preset} label={presetName(lang, preset)} />
      {:else}
        <StatusBadge kind="wait">{tm(lang, "status.waiting", { hotkey })}</StatusBadge>
        <details>
          <summary>{tm(lang, "wizard.scale.noReaction")}</summary>
          <p>{tm(lang, "wizard.scale.noReaction.body", { hotkey })}</p>
        </details>
      {/if}
    </section>
  {/each}
</div>

<details>
  <summary>{tm(lang, "wizard.scale.grid")}</summary>
  <svg class="scheme" viewBox="0 0 360 64" role="img" aria-label={tm(lang, "wizard.scale.grid.body")}>
    <path class="map" d="M10 20h340M10 44h340M40 8v48M120 8v48M200 8v48M280 8v48" />
    <path class="ours" d="M10 20h340M40 8v48M124 8v48M208 8v48M292 8v48" />
  </svg>
  <p>{tm(lang, "wizard.scale.grid.body")}</p>
</details>

<style>
  .lead {
    margin-top: -12px;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h2:focus {
    outline: none;
  }

  ol {
    display: grid;
    gap: 4px;
    margin: 0;
    padding-left: 20px;
    color: var(--text-2);
  }

  hr {
    width: 100%;
    margin: 4px 0;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .scheme {
    width: min(360px, 100%);
    margin-top: 8px;
  }

  .map {
    stroke: var(--text-3);
    stroke-width: 1.5;
  }

  .ours {
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }
</style>

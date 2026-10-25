<script lang="ts">
  // Measuring panel (plan/ux.md O-1, O-2). Top-left; it moves to the right corner when the
  // cursor or a point comes close (decided by the parent).
  import type { Session } from "../../lib/core/session";
  import type { Language, Preset } from "../../lib/core/types";
  import { formatMeters, formatPx } from "../../lib/core/format";
  import { t, type Key } from "../../lib/i18n";
  import PresetBadge from "./PresetBadge.svelte";
  import {
    currentResult,
    dhLine,
    distanceText,
    liveMeters,
    mortarLine,
    segmentsLine,
    travelRows,
    verifyLine,
  } from "./view";

  let {
    session,
    lang,
    hotkeys,
    monitorLabel,
    height = $bindable(0),
  }: {
    session: Session;
    lang: Language;
    hotkeys: Readonly<Record<Preset, string>>;
    monitorLabel: string;
    height?: number;
  } = $props();

  const result = $derived(currentResult(session));
  const live = $derived(liveMeters(session));
  const note = $derived.by(() => {
    const n = session.note;
    if (!n) return null;
    if (n.kind === "carried") return t(lang, "ov.carried");
    if (n.kind === "saved") return t(lang, "cal.saved", { monitor: monitorLabel });
    if (n.kind === "saveFailed") return t(lang, `ov.saveFailed.${n.failure ?? "other"}`);
    const scale = session.scales[session.preset];
    if (n.kind === "nudged" && scale) return t(lang, "ov.nudged", { px: formatPx(scale.cellPx, lang) });
    return null;
  });
  const other = $derived<Preset>(session.preset === "near" ? "far" : "near");
  const keys: Key[] = [
    "ov.keys.point",
    "ov.keys.undo",
    "ov.keys.clear",
    "ov.keys.height",
    "ov.keys.nudge",
    "ov.keys.origin",
    "ov.keys.grid",
    "ov.keys.recalibrate",
  ];
</script>

<section class="glass panel" bind:clientHeight={height} aria-live="polite">
  <PresetBadge preset={session.preset} hotkey={hotkeys[session.preset]} {lang} />
  {#if note}
    <p class="hint note" class:warn={session.note?.kind === "saveFailed"}>
      {#if session.note?.kind === "saveFailed"}<span class="icon" aria-hidden="true">⚠</span>{/if}{note}
    </p>
  {/if}

  {#if session.carried}
    <p class="row anchor">{t(lang, "ov.anchor")}</p>
    <p class="hint">{t(lang, "ov.anchor.hint")}</p>
  {:else if result}
    {@const distance = distanceText(lang, result)}
    {@const travel = travelRows(lang, result, session.speeds.sprintMps, session.speeds.daciaKmh)}
    {@const mortar = mortarLine(lang, result)}
    {@const segments = segmentsLine(lang, result)}
    <p class="distance"><span class="big-number">{distance.value}</span> <span class="error">{distance.error}</span></p>
    {#if segments}<p class="row">{segments}</p>{/if}
    <div class="travel">
      {#each travel as row (row.label)}
        <span>{row.label}</span>
        <span class="time">{row.time}</span>
        <span class="speed">{row.speed}{#if row.note}<br /><span class="unverified">{row.note}</span>{/if}</span>
      {/each}
    </div>
    <p class="row" class:warn={mortar.warn}>{#if mortar.warn}<span class="icon" aria-hidden="true">⚠</span>{/if}{mortar.text}</p>
    {#if session.preset === "far" && result.mortar.status === "ok"}
      <p class="hint">{t(lang, "ov.mortar.zoomTip", { hotkey: hotkeys.near })}</p>
    {/if}
    <p class="row">{dhLine(lang, session.dhM)}</p>
  {:else if session.points.length === 1}
    <p class="row">{t(lang, "ov.prompt.second")}{#if live !== null} · {t(lang, "ov.live", { m: formatMeters(live, lang) })}{/if}</p>
    <p class="row">{dhLine(lang, session.dhM)}</p>
  {:else}
    <p class="row">{t(lang, "ov.prompt.first")}</p>
    <p class="hint">{t(lang, "ov.hints.wheel")}</p>
  {/if}

  {#if verifyLine(lang, session)}
    <p class="hint verify"><span class="ok" aria-hidden="true">✓</span> {verifyLine(lang, session)}</p>
  {/if}

  <hr />
  {#if session.showKeys}
    <p class="kicker">{t(lang, "ov.keys.title")}</p>
    <ul class="hint keys">
      {#each keys as key (key)}<li>{t(lang, key)}</li>{/each}
      <li>{t(lang, "ov.keys.exit", { hotkey: hotkeys[session.preset] })}</li>
      <li>{t(lang, "ov.keys.switch", { hotkey: hotkeys[other] })}</li>
    </ul>
  {:else}
    <p class="hint">{t(lang, "ov.hints.short")}</p>
  {/if}
</section>

<style>
  .panel {
    width: 360px;
    padding: 16px 18px;
    display: grid;
    gap: 6px;
  }

  p {
    margin: 0;
  }

  /* Text in the UI font; figures tabular so numbers do not jump while the cursor moves. */
  .panel {
    font-variant-numeric: tabular-nums;
  }

  .row {
    font: 400 15px/20px var(--font-ui);
  }

  .distance {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 4px 0 2px;
  }

  .error {
    color: var(--text-2);
    font: 400 15px/20px var(--font-ui);
  }

  .travel {
    display: grid;
    grid-template-columns: auto auto 1fr;
    column-gap: 14px;
    row-gap: 4px;
    font: 400 15px/20px var(--font-ui);
  }

  .time {
    font-weight: 600;
  }

  .speed {
    color: var(--text-2);
  }

  .unverified {
    font-size: 13px;
    line-height: 16px;
  }


  .note {
    color: var(--accent-text);
  }

  .note.warn {
    color: var(--warn);
  }

  .anchor {
    color: var(--accent-text);
    font-weight: 600;
  }

  .ok {
    color: var(--ok);
  }

  hr {
    width: 100%;
    margin: 6px 0 2px;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }

  .keys {
    margin: 0;
    padding-left: 18px;
  }
</style>

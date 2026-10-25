<script lang="ts">
  // Scale setup (plan/ux.md O-3), centred at the top, 520 px. Clicks pass through the panel
  // except on step 1, where its two buttons choose the cells.
  import { formatPx } from "../../lib/core/format";
  import { stageNumber, type Session } from "../../lib/core/session";
  import type { CellMeters, Language, Preset } from "../../lib/core/types";
  import { t } from "../../lib/i18n";
  import { fineScale, liveCellPx, presetName } from "./view";

  let {
    session,
    lang,
    hotkeys,
    monitorLabel,
    onchoose,
  }: {
    session: Session;
    lang: Language;
    hotkeys: Readonly<Record<Preset, string>>;
    monitorLabel: string;
    onchoose: (cells: CellMeters) => void;
  } = $props();

  const draft = $derived(session.draft!);
  const step = $derived(stageNumber(draft.stage));
  const live = $derived(liveCellPx(draft, session.cursor));
  const fine = $derived(fineScale(lang, session));
  const hintStep1 = $derived(t(lang, session.preset === "near" ? "cal.step1.hint.near" : "cal.step1.hint.far"));
</script>

<section class="glass panel" class:interactive={draft.stage === "step"} aria-live="polite">
  <header>
    <p class="kicker">{t(lang, "cal.title", { preset: presetName(lang, session.preset), hotkey: hotkeys[session.preset] })}</p>
    <p class="hint">{t(lang, "cal.step", { n: step })}</p>
  </header>

  {#if draft.missing}
    <p class="warn"><span class="icon" aria-hidden="true">⚠</span>{t(lang, "cal.newMonitor", { monitor: monitorLabel })}</p>
  {/if}

  {#if draft.stage === "step"}
    <p class="lead">{t(lang, "cal.step1")}</p>
    <div class="choices">
      <button type="button" class:chosen={draft.cellMeters === 1000} onclick={() => onchoose(1000)}>
        <kbd>1</kbd> {t(lang, "cal.step1.big")}
      </button>
      <button type="button" class:chosen={draft.cellMeters === 100} onclick={() => onchoose(100)}>
        <kbd>2</kbd> {t(lang, "cal.step1.small")}
      </button>
    </div>
    <p class="hint">{hintStep1}</p>
    <p class="hint">{t(lang, "cal.desktopTip")} {t(lang, "cal.cancel")}</p>
  {:else if draft.stage === "origin"}
    <p class="lead">{t(lang, "cal.step2")}</p>
    <p class="hint">{t(lang, "cal.step2.hint")}</p>
  {:else if draft.stage === "neighbour"}
    <p class="lead">{t(lang, "cal.step3")}</p>
    <p class="hint num">{#if live !== null}≈ {formatPx(live, lang)} · {/if}{t(lang, "cal.step3.hint")}</p>
  {:else}
    <p class="lead">{t(lang, "cal.step4")}</p>
    <p class="hint">{t(lang, "cal.step4.keys")}</p>
    {#if fine}
      <p class="hint num">{fine.text}</p>
      {#if fine.tenX}
        <p class="warn" role="alert">
          <span class="icon" aria-hidden="true">⚠</span>{t(lang, "cal.warn10x")} {t(lang, "cal.warn10x.keys")}
        </p>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .panel {
    width: 520px;
    padding: 16px 20px;
    display: grid;
    gap: 8px;
    pointer-events: none;
  }

  .panel.interactive {
    pointer-events: auto;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }

  p {
    margin: 0;
  }

  .lead {
    font: 600 15px/20px var(--font-ui);
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--r-sm);
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
    font: 600 14px/20px var(--font-ui);
    text-align: left;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease);
  }

  button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  button.chosen {
    border-color: var(--accent);
    background: rgba(242, 169, 0, 0.16);
  }
</style>

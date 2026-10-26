<script lang="ts">
  // Wizard step 1 (plan/ux.md M-1): what Mapper does in three cards, the two zooms, the
  // honest limit, and the interface language.
  import Segmented from "../../../../lib/components/Segmented.svelte";
  import type { Language } from "../../../../lib/core/types";
  import { tm } from "../../../../lib/i18n/main";
  import type { AppSnapshot } from "../../../../lib/ipc/types";
  import type { MainStore } from "../../store.svelte";

  let {
    store,
    snapshot,
    heading = $bindable(),
  }: { store: MainStore; snapshot: AppSnapshot; heading?: HTMLHeadingElement | undefined } = $props();

  const lang = $derived(snapshot.settings.language);
  const hotkeys = $derived(snapshot.settings.hotkeys);
  const cards = $derived([
    tm(lang, "wizard.how.card1"),
    tm(lang, "wizard.how.card2", { near: hotkeys.near, far: hotkeys.far }),
    tm(lang, "wizard.how.card3"),
  ]);
  const languages: readonly { value: Language; label: string }[] = [
    { value: "ru", label: "Русский" },
    { value: "en", label: "English" },
  ];
</script>

<h1 bind:this={heading} tabindex="-1">{tm(lang, "wizard.how.title")}</h1>
<p class="lead">{tm(lang, "wizard.how.lead")}</p>

<div class="cards">
  {#each cards as text, i (i)}
    <div class="card">
      <svg class="sketch" viewBox="0 0 120 48" aria-hidden="true">
        <path class="grid" d="M0 16h120M0 32h120M30 0v48M60 0v48M90 0v48" />
        {#if i > 0}<path class="ruler" d="M18 38 L96 12" />{/if}
        {#if i > 1}<circle class="dot" cx="18" cy="38" r="3.5" /><circle class="dot" cx="96" cy="12" r="3.5" />{/if}
      </svg>
      <p class="num step">{i + 1}</p>
      <p>{text}</p>
    </div>
  {/each}
</div>

<dl class="zooms">
  <dt><kbd class="hotkey num">{hotkeys.near}</kbd></dt>
  <dd>{tm(lang, "wizard.how.near")}</dd>
  <dt><kbd class="hotkey num">{hotkeys.far}</kbd></dt>
  <dd>{tm(lang, "wizard.how.far")}</dd>
</dl>

<p class="text">{tm(lang, "wizard.how.honest")}</p>

<div class="row">
  <span>{tm(lang, "wizard.how.language")}</span>
  <Segmented label={tm(lang, "wizard.how.language")} options={languages} value={lang} onchange={(language) => store.update({ language })} />
</div>

<style>
  .lead {
    margin: -12px 0 0;
    color: var(--text-2);
    font-size: 15px;
  }

  .card p {
    margin: 0;
  }

  .step {
    color: var(--accent-text);
    font-weight: 700;
  }

  .sketch {
    width: 100%;
    height: 48px;
  }

  .grid {
    stroke: rgba(242, 169, 0, 0.25);
    stroke-width: 1;
  }

  .ruler {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .dot {
    fill: #15171b;
    stroke: var(--accent);
    stroke-width: 1.6;
  }

  .zooms {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 8px 12px;
    margin: 0;
  }

  dd {
    margin: 0;
    color: var(--text-2);
  }
</style>

<script lang="ts">
  // Wizard step 3 (plan/ux.md M-3): the display mode PUBG needs, as a tip — Mapper cannot see
  // the game and does not pretend to check it.
  import { tm } from "../../../../lib/i18n/main";
  import type { AppSnapshot } from "../../../../lib/ipc/types";

  let { snapshot, heading = $bindable() }: { snapshot: AppSnapshot; heading?: HTMLHeadingElement | undefined } = $props();

  const lang = $derived(snapshot.settings.language);
</script>

<h1 bind:this={heading} tabindex="-1">{tm(lang, "wizard.mode.title")}</h1>
<p class="text">{tm(lang, "wizard.mode.body")}</p>

<section class="card">
  <h2>{tm(lang, "wizard.mode.howTitle")}</h2>
  <ol>
    <li>{tm(lang, "wizard.mode.how1")}</li>
    <li>{tm(lang, "wizard.mode.how2")}</li>
  </ol>
</section>

<ul class="info">
  <li>{tm(lang, "wizard.mode.admin")}</li>
  <li>{tm(lang, "wizard.mode.monitor")}</li>
</ul>

<p class="muted">{tm(lang, "wizard.mode.cantCheck", { hotkey: snapshot.settings.hotkeys.near })}</p>

<style>
  ol {
    margin: 0;
    padding-left: 20px;
    color: var(--text-2);
  }

  .info {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-2);
  }

  .info li {
    position: relative;
    padding-left: 26px;
  }

  /* "(i)": an info mark, not a warning. */
  .info li::before {
    content: "i";
    position: absolute;
    left: 0;
    top: 1px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border: 1.5px solid var(--text-3);
    border-radius: 50%;
    color: var(--text-3);
    font: 700 11px/1 var(--font-ui);
  }
</style>

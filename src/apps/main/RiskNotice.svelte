<script lang="ts">
  // The one risk text (C-7): wizard step 2 and About show exactly this block.
  import type { Language } from "../../lib/core/types";
  import { tm } from "../../lib/i18n/main";

  let { lang }: { lang: Language } = $props();
</script>

<section class="risk" aria-labelledby="risk-headline">
  <svg class="icon" viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
    <path d="M8 1.8 15 14H1z" />
    <path d="M8 6v3.6M8 11.6v.4" />
  </svg>
  <div>
    <h2 id="risk-headline">{tm(lang, "risk.headline")}</h2>
    <p>{tm(lang, "risk.body")}</p>
    <p>{tm(lang, "risk.events")}</p>
  </div>
</section>

<style>
  .risk {
    display: flex;
    gap: 12px;
    padding: 16px 18px;
    border: 1px solid rgba(255, 184, 112, 0.35);
    border-radius: var(--r-md);
    background: rgba(255, 184, 112, 0.06);
  }

  .icon {
    flex: none;
    fill: none;
    stroke: var(--warn);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  h2 {
    margin: 0 0 6px;
    color: var(--warn);
    font: 600 15px/20px var(--font-ui);
  }

  p {
    margin: 0;
    color: var(--text-2);
  }

  p + p {
    margin-top: 6px;
  }
</style>

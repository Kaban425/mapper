<script lang="ts">
  // Windows did not hand focus over (plan/ux.md O-4). The click that answers it is swallowed.
  import type { Language } from "../../lib/core/types";
  import { t } from "../../lib/i18n";

  let { lang, seconds }: { lang: Language; seconds: number } = $props();
</script>

<div class="glass box" role="alert">
  <p class="title">{t(lang, "ov.focus.title")}</p>
  <p class="hint">{t(lang, "ov.focus.body")}</p>
  <p class="hint">{t(lang, "ov.focus.countdown", { s: seconds })}</p>
</div>

<style>
  .box {
    padding: 18px 24px;
    max-width: 460px;
    text-align: center;
    pointer-events: none;
  }

  p {
    margin: 0;
  }

  .title {
    margin-bottom: 6px;
    font: 600 20px/28px var(--font-display);
  }
</style>

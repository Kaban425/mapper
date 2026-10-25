<script lang="ts">
  // The mode is always a word plus a shape (lens with "+" or "−"), never colour alone.
  import type { Language, Preset } from "../../lib/core/types";
  import { presetName } from "./view";

  let { preset, hotkey, lang }: { preset: Preset; hotkey: string; lang: Language } = $props();
</script>

<p class="kicker badge">
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="6.5" cy="6.5" r="4.5" />
    <line x1="10" y1="10" x2="14.5" y2="14.5" />
    <line x1="4.5" y1="6.5" x2="8.5" y2="6.5" />
    {#if preset === "near"}<line x1="6.5" y1="4.5" x2="6.5" y2="8.5" />{/if}
  </svg>
  <span>{presetName(lang, preset)} · {hotkey}</span>
</p>

<style>
  .badge {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  svg {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
</style>

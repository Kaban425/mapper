<script lang="ts">
  // The result HUD (plan/ux.md §4.3): text is built here, in the HUD's own language, from the
  // numbers Rust forwards. It never calls a command and has no capability for one.
  import { onMount } from "svelte";

  import "../../lib/styles/glass.css";
  import { formatDuration } from "../../lib/core/format";
  import type { Language, MeasurementResult } from "../../lib/core/types";
  import type { HudShow } from "../../lib/ipc/types";
  import { t } from "../../lib/i18n";
  import { on } from "../../lib/ipc/events";
  import { dhValue, distanceText, mortarLine, presetName, type Line } from "../../lib/view/result";

  /** Rust hides the window after 10 s; the fade-out finishes just before. */
  const VISIBLE_MS = 10_000;
  const FADE_MS = 220;

  let shown = $state<{ payload: HudShow; id: number } | null>(null);
  let leaving = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    const ready = on("hud-show", "hud", (payload) => {
      clearTimeout(timer);
      leaving = false;
      shown = { payload, id: (shown?.id ?? 0) + 1 };
      timer = setTimeout(() => (leaving = true), VISIBLE_MS - FADE_MS);
    });
    return () => {
      clearTimeout(timer);
      void ready.then((stop) => stop());
    };
  });

  function lastLine(lang: Language, r: MeasurementResult): Line {
    const dh = dhValue(lang, r.dhM);
    if (r.segmentsM.length > 1) return { text: `${t(lang, "hud.segments", { n: r.segmentsM.length })} · ${dh}` };
    const mortar = mortarLine(lang, r);
    return mortar.warn ? mortar : { text: `${mortar.text} · ${dh}` };
  }
</script>

{#if shown?.payload.kind === "notice"}
  {@const { lang, hotkey } = shown.payload}
  {#key shown.id}
    <main class="glass hud" class:leaving style:--ov-alpha={shown.payload.opacity} {lang}>
      <p class="kicker">{t(lang, "hud.brand")}</p>
      <p class="title">{t(lang, "hud.routeKept.title")}</p>
      <p class="row">{t(lang, "hud.routeKept.body", { hotkey })}</p>
      <p class="row">{t(lang, "hud.routeKept.next")}</p>
    </main>
  {/key}
{:else if shown?.payload.kind === "result"}
  {@const { result, lang } = shown.payload}
  {@const distance = distanceText(lang, result)}
  {@const last = lastLine(lang, result)}
  {#key shown.id}
    <main class="glass hud" class:leaving style:--ov-alpha={shown.payload.opacity} {lang}>
      <p class="kicker">{t(lang, "hud.brand")} · {presetName(lang, result.preset)}</p>
      <p class="distance"><span class="big">{distance.value}</span> <span class="error">{distance.error}</span></p>
      <p class="row">
        {t(lang, "hud.run", { t: formatDuration(result.travel.sprintS) })} · {t(lang, "hud.dacia", {
          t: formatDuration(result.travel.daciaS),
        })}
      </p>
      <p class="row" class:warn={last.warn}>{#if last.warn}<span class="icon" aria-hidden="true">⚠</span>{/if}{last.text}</p>
    </main>
  {/key}
{/if}

<style>
  .hud {
    position: fixed;
    inset: 0;
    padding: 14px 18px;
    display: grid;
    align-content: start;
    gap: 4px;
    animation: appear var(--dur-slow) var(--ease) both;
  }

  .hud.leaving {
    animation: vanish var(--dur-slow) var(--ease) both;
  }

  p {
    margin: 0;
  }

  .distance {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .big {
    color: var(--accent);
    font: 600 30px/34px var(--font-num);
    font-variant-numeric: tabular-nums;
  }

  .error,
  .row {
    color: var(--text-2);
    font: 400 14px/20px var(--font-ui);
    font-variant-numeric: tabular-nums;
  }

  .row.warn {
    color: var(--warn);
  }

  .title {
    color: var(--accent);
    font: 600 20px/28px var(--font-display);
  }

  @keyframes appear {
    from {
      opacity: 0;
    }
  }

  @keyframes vanish {
    to {
      opacity: 0;
    }
  }
</style>

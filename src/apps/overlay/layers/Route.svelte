<script lang="ts">
  // The measured route: yellow line with a dark halo, ticks every 100 m (long every 1 km),
  // the length of each segment at its middle, the total at the last point, a rubber band
  // from the last point to the cursor with the live length next to the cursor. A route carried
  // from the other zoom follows the cursor as a ghost until the anchor click places it.
  import { metersPerPx } from "../../../lib/core/calibration";
  import { reproject } from "../../../lib/core/carry";
  import { formatMeters } from "../../../lib/core/format";
  import { segmentPx, ticks } from "../../../lib/core/measurement";
  import type { Session } from "../../../lib/core/session";
  import { t } from "../../../lib/i18n";
  import { liveMeters } from "../view";
  import type { Language } from "../../../lib/core/types";

  let { session, lang }: { session: Session; lang: Language } = $props();

  const LABEL_OFFSET = 12;

  const ghost = $derived.by(() => {
    const scale = session.scales[session.preset];
    if (!session.carried || !scale || !session.cursor || session.mode !== "measure") return null;
    const points = reproject(session.carried, session.cursor, metersPerPx(scale));
    return points.length > 0 ? { points, polyline: points.map((p) => `${p.x},${p.y}`).join(" ") } : null;
  });

  // Narrow inputs keep their identity across mouse moves (the session object does not), so
  // the route, its ticks and labels are rebuilt only when the points or the scale change.
  const scale = $derived(session.scales[session.preset]);
  const measuring = $derived(session.mode === "measure");
  const points = $derived(session.points);

  const view = $derived.by(() => {
    if (!measuring || !scale || points.length === 0) return null;
    const mpp = scale.cellMeters / scale.cellPx;
    const segments = points.slice(1).map((b, i) => {
      const a = points[i]!;
      const length = segmentPx(a, b);
      // Normal to the segment, pointing up or right, so labels sit beside the line.
      const nx = length > 0 ? -(b.y - a.y) / length : 0;
      const ny = length > 0 ? (b.x - a.x) / length : -1;
      const flip = ny > 0 ? -1 : 1;
      return {
        ticks: ticks(a, b, scale),
        label: formatMeters(length * mpp, lang),
        x: (a.x + b.x) / 2 + nx * LABEL_OFFSET * flip,
        y: (a.y + b.y) / 2 + ny * LABEL_OFFSET * flip,
      };
    });
    const totalM = points.slice(1).reduce((sum, p, i) => sum + segmentPx(points[i]!, p) * mpp, 0);
    const last = points[points.length - 1]!;
    return {
      polyline: points.map((p) => `${p.x},${p.y}`).join(" "),
      segments,
      points,
      last,
      total: points.length >= 3 ? { text: t(lang, "ov.total", { m: formatMeters(totalM, lang) }), x: last.x + 14, y: last.y + 22 } : null,
    };
  });

  /** What follows the cursor: the rubber band from the last point and the live length. */
  const pointer = $derived.by(() => {
    const cursor = session.cursor;
    if (!view || !cursor) return null;
    const live = liveMeters(session);
    return {
      rubber: session.focused ? { from: view.last, to: cursor } : null,
      live: live !== null ? { text: t(lang, "ov.live", { m: formatMeters(live, lang) }), x: cursor.x + 16, y: cursor.y + 28 } : null,
    };
  });
</script>

{#if view}
  <svg class="route" width="100%" height="100%" aria-hidden="true">
    {#if pointer?.rubber}
      <line class="rubber" x1={pointer.rubber.from.x} y1={pointer.rubber.from.y} x2={pointer.rubber.to.x} y2={pointer.rubber.to.y} />
    {/if}
    {#if view.points.length > 1}
      <polyline class="halo" points={view.polyline} />
      <polyline class="line" points={view.polyline} />
    {/if}
    {#each view.segments as segment, i (i)}
      {#each segment.ticks as tick, j (j)}
        <line class="tick" class:major={tick.major} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
      {/each}
      <text class="label" x={segment.x} y={segment.y} text-anchor="middle" dominant-baseline="middle">{segment.label}</text>
    {/each}
    {#each view.points as p, i (i)}
      <circle class="point" cx={p.x} cy={p.y} r="5" />
      {#if i === 0}
        <circle class="mortar" cx={p.x} cy={p.y} r="2" />
      {/if}
    {/each}
    {#if view.total}
      <text class="label total" x={view.total.x} y={view.total.y}>{view.total.text}</text>
    {/if}
    {#if pointer?.live}
      <text class="label live" x={pointer.live.x} y={pointer.live.y}>{pointer.live.text}</text>
    {/if}
  </svg>
{/if}

{#if ghost}
  <svg class="route ghost" width="100%" height="100%" aria-hidden="true">
    <polyline class="ghost-line" points={ghost.polyline} />
    {#each ghost.points as p, i (i)}
      <circle class="ghost-point" cx={p.x} cy={p.y} r={i === 0 ? 6 : 4} />
    {/each}
  </svg>
{/if}

<style>
  .route {
    position: absolute;
    inset: 0;
    pointer-events: none;
    forced-color-adjust: none;
  }

  .halo {
    fill: none;
    stroke: var(--halo);
    stroke-width: 3.6px;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.6px;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .rubber {
    stroke: var(--accent-soft);
    stroke-width: 1.5px;
    stroke-dasharray: 6 5;
  }

  .tick {
    stroke: var(--accent);
    stroke-width: 1.1px;
  }

  .tick.major {
    stroke-width: 1.5px;
  }

  .point {
    fill: #15171b;
    stroke: var(--accent);
    stroke-width: 1.8px;
  }

  .mortar {
    fill: var(--accent);
  }

  .label {
    fill: var(--text);
    font: 500 13px var(--font-ui);
    font-variant-numeric: tabular-nums;
    paint-order: stroke;
    stroke: var(--halo);
    stroke-width: 3px;
    stroke-linejoin: round;
  }

  .ghost-line {
    fill: none;
    stroke: var(--accent);
    stroke-opacity: 0.6;
    stroke-width: 1.5px;
    stroke-dasharray: 5 4;
  }

  .ghost-point {
    fill: none;
    stroke: var(--accent);
    stroke-opacity: 0.8;
    stroke-width: 1.5px;
  }

  .total,
  .live {
    fill: var(--accent);
  }
</style>
<script lang="ts">
  // The ruler's grid: pale while measuring (G hides it), bright and dashed on setup step 4,
  // a guide line from the origin to the cursor on step 3.
  import { MIN_CELL_PX } from "../../../lib/core/constants";
  import type { Session } from "../../../lib/core/session";
  import type { Point } from "../../../lib/core/types";

  let { session }: { session: Session } = $props();

  interface Line {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  }

  function gridLines(origin: Point, cellPx: number, w: number, h: number): Line[] {
    if (cellPx < MIN_CELL_PX) return [];
    const lines: Line[] = [];
    const first = (start: number) => ((start % cellPx) + cellPx) % cellPx;
    for (let x = first(origin.x); x <= w; x += cellPx) lines.push({ x1: x, y1: 0, x2: x, y2: h });
    for (let y = first(origin.y); y <= h; y += cellPx) lines.push({ x1: 0, y1: y, x2: w, y2: y });
    return lines;
  }

  // The session object changes on every mouse move; these narrow values keep their identity,
  // so the lines (up to ~1000 at small cells) are rebuilt only when the grid itself changes.
  const viewport = $derived(session.viewport);
  const calibrating = $derived(session.mode === "calibrate");
  const draft = $derived(session.draft);
  const scale = $derived(session.scales[session.preset]);
  const showGrid = $derived(session.showGrid);

  const lines = $derived.by(() => {
    const { w, h } = viewport;
    if (calibrating) {
      const d = draft;
      return d?.stage === "fine" && d.origin && d.cellPx !== null ? gridLines(d.origin, d.cellPx, w, h) : [];
    }
    return scale && showGrid ? gridLines(scale.origin, scale.cellPx, w, h) : [];
  });
  const origin = $derived(calibrating ? (draft?.origin ?? null) : null);
  const guide = $derived.by(() => {
    const from = draft?.stage === "neighbour" ? draft.origin : null;
    return calibrating && from && session.cursor ? { ...from, to: session.cursor } : null;
  });
</script>

<svg class="grid" class:calibrating width="100%" height="100%" aria-hidden="true">
  {#each lines as l, i (i)}
    <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
  {/each}
  {#if guide}
    <line class="guide" x1={guide.x} y1={guide.y} x2={guide.to.x} y2={guide.to.y} />
  {/if}
  {#if origin}
    <circle class="origin" cx={origin.x} cy={origin.y} r="7" />
  {/if}
</svg>

<style>
  .grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    forced-color-adjust: none;
  }

  line {
    stroke: var(--accent);
    stroke-width: 1px;
    stroke-opacity: 0.28;
    shape-rendering: crispEdges;
  }

  .calibrating line {
    stroke-opacity: 0.85;
    stroke-dasharray: 6 4;
  }

  .guide {
    stroke-opacity: 0.9;
    stroke-width: 1.5px;
    stroke-dasharray: none;
    shape-rendering: auto;
  }

  .origin {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2px;
    paint-order: stroke;
    filter: drop-shadow(0 0 1.5px var(--halo));
  }
</style>

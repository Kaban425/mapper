<script lang="ts">
  // The overlay window. Between sessions it renders nothing (that empty frame is what Rust
  // waits for before hiding); everything a session needs arrives in `overlay-activating`.
  import { onMount } from "svelte";

  import "../../lib/styles/glass.css";
  import { logFailure } from "../../lib/ipc/commands";
  import CalibratePanel from "./CalibratePanel.svelte";
  import ClickToStart from "./ClickToStart.svelte";
  import { OverlayController } from "./controller.svelte";
  import Grid from "./layers/Grid.svelte";
  import Route from "./layers/Route.svelte";
  import MeasurePanel from "./MeasurePanel.svelte";
  import { panelSide } from "./view";

  const PANEL_WIDTH = 360;
  const EDGE = 24;

  const overlay = new OverlayController();
  let panelHeight = $state(0);

  const session = $derived(overlay.session);
  const side = $derived.by(() => {
    const h = panelHeight || 200;
    const left = { x: EDGE, y: EDGE, w: PANEL_WIDTH, h };
    const right = { x: session.viewport.w - EDGE - PANEL_WIDTH, y: EDGE, w: PANEL_WIDTH, h };
    return panelSide(left, right, session.cursor, session.points);
  });

  onMount(() => {
    overlay.connect().catch((e) => logFailure("overlay events", e));
    const options = { passive: false } as const;
    const keydown = (e: KeyboardEvent) => overlay.onKeyDown(e);
    const keyup = (e: KeyboardEvent) => overlay.onKeyUp(e);
    const wheel = (e: WheelEvent) => overlay.onWheel(e);
    const focus = () => overlay.onFocusChange(true);
    const blur = () => overlay.onFocusChange(false);
    const pointerdown = (e: PointerEvent) => overlay.onPointerDown(e);
    const pointermove = (e: PointerEvent) => overlay.onPointerMove(e);
    // The middle button would start auto-scroll, the right one open a menu.
    const mousedown = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    const contextmenu = (e: MouseEvent) => e.preventDefault();
    const listeners: [string, EventListener, AddEventListenerOptions?][] = [
      ["keydown", keydown as EventListener],
      ["keyup", keyup as EventListener],
      ["wheel", wheel as EventListener, options],
      ["focus", focus],
      ["blur", blur],
      ["pointerdown", pointerdown as EventListener],
      ["pointermove", pointermove as EventListener],
      ["mousedown", mousedown as EventListener],
      ["contextmenu", contextmenu as EventListener],
    ];
    for (const [type, listener, opts] of listeners) window.addEventListener(type, listener, opts);
    return () => {
      for (const [type, listener] of listeners) window.removeEventListener(type, listener);
    };
  });
</script>

{#if session.active}
  <div class="root" style:--ov-alpha={overlay.opacity} lang={overlay.lang}>
    <Grid {session} />
    <Route {session} lang={overlay.lang} />

    {#if session.mode === "calibrate" && session.draft}
      <div class="top-center">
        <CalibratePanel
          {session}
          lang={overlay.lang}
          hotkeys={overlay.hotkeys}
          monitorLabel={overlay.monitorLabel}
          onchoose={(cells) => overlay.chooseCells(cells)}
        />
      </div>
    {:else}
      <div class="corner" class:right={side === "right"}>
        <MeasurePanel
          {session}
          lang={overlay.lang}
          hotkeys={overlay.hotkeys}
          monitorLabel={overlay.monitorLabel}
          bind:height={panelHeight}
        />
      </div>
    {/if}

    {#if session.focusMissed && !session.focused}
      <div class="center"><ClickToStart lang={overlay.lang} seconds={overlay.countdown} /></div>
    {/if}
  </div>
{/if}

<style>
  .root {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.06);
    cursor: crosshair;
    overflow: hidden;
  }

  .corner {
    position: absolute;
    top: 24px;
    left: 24px;
    pointer-events: none;
    transition:
      left var(--dur-base) var(--ease),
      transform var(--dur-base) var(--ease);
  }

  .corner.right {
    left: calc(100% - 24px);
    transform: translateX(-100%);
  }

  .top-center {
    position: absolute;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
  }

  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
</style>

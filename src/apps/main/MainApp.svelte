<script lang="ts">
  // The main window (plan/ux.md §4.1): the first-run wizard until it is done or skipped, then
  // Home / Settings / About with a side navigation. Shortcuts: Ctrl+1/2/3 screens, Ctrl+Q quit,
  // Ctrl+plus / minus / 0 zoom (80–200 %, applied by Rust as WebView2 zoom). The tray dialog
  // shows on the first close.
  import { onMount } from "svelte";

  import "./main.css";
  import Button from "../../lib/components/Button.svelte";
  import Dialog from "../../lib/components/Dialog.svelte";
  import { tm } from "../../lib/i18n/main";
  import Nav from "./Nav.svelte";
  import About from "./screens/About.svelte";
  import Home from "./screens/Home.svelte";
  import Settings from "./screens/Settings.svelte";
  import Wizard from "./screens/Wizard.svelte";
  import { MainStore, type Screen } from "./store.svelte";

  const store = new MainStore();
  const ZOOM_STEP = 0.1;
  const SCREENS: readonly Screen[] = ["home", "settings", "about"];

  onMount(() => {
    void store.connect();
  });

  const snapshot = $derived(store.snapshot);
  const lang = $derived(store.lang);
  const zoom = $derived(snapshot?.settings.uiZoom ?? 1);
  const hotkeys = $derived(snapshot?.settings.hotkeys ?? { near: "Alt+Q", far: "Alt+W" });

  $effect(() => {
    document.documentElement.lang = lang;
  });

  // Another screen opens at its top, the reader at its heading — unless something on it
  // already took the focus ("choose another combination" focuses the recorder).
  let content: HTMLElement | undefined = $state();
  $effect(() => {
    void store.screen;
    if (!content) return;
    content.scrollTo(0, 0);
    if (!content.contains(document.activeElement)) content.querySelector<HTMLElement>("h1")?.focus();
  });

  function setZoom(next: number): void {
    const clamped = Math.round(Math.min(2, Math.max(0.8, next)) * 10) / 10;
    if (clamped !== zoom) void store.update({ uiZoom: clamped });
  }

  function onkeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey || event.altKey || event.metaKey || !snapshot) return;
    const index = ["Digit1", "Digit2", "Digit3"].indexOf(event.code);
    if (index >= 0 && snapshot.settings.firstRunDone) {
      event.preventDefault();
      store.screen = SCREENS[index]!;
    } else if (event.code === "KeyQ") {
      event.preventDefault();
      void store.quit();
    } else if (event.code === "Equal" || event.code === "NumpadAdd") {
      event.preventDefault();
      setZoom(zoom + ZOOM_STEP);
    } else if (event.code === "Minus" || event.code === "NumpadSubtract") {
      event.preventDefault();
      setZoom(zoom - ZOOM_STEP);
    } else if (event.code === "Digit0" || event.code === "Numpad0") {
      event.preventDefault();
      setZoom(1);
    }
  }
</script>

<svelte:window {onkeydown} />

{#if !snapshot}
  <p class="loading" role="status">{tm(lang, "app.loading")}</p>
{:else if !snapshot.settings.firstRunDone}
  <Wizard {store} {snapshot} />
{:else}
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo" aria-hidden="true"></span>
        <div>
          <p class="name">Mapper</p>
          <p class="subtitle">{tm(lang, "app.subtitle")}</p>
        </div>
      </div>
      <Nav {lang} current={store.screen} onselect={(screen) => (store.screen = screen)} />
      <p class="version num">v{snapshot.version}</p>
    </aside>
    <main class="content" bind:this={content}>
      {#if store.error}<p class="banner error" role="alert">{tm(lang, store.error)}</p>{/if}
      {#if store.screen === "home"}
        <Home {store} {snapshot} />
      {:else if store.screen === "settings"}
        <Settings {store} {snapshot} />
      {:else}
        <About {store} {snapshot} />
      {/if}
    </main>
    <!-- Last in the DOM so Tab reaches the content first; shown at the foot of the sidebar. -->
    <div class="quit">
      <Button variant="ghost" onclick={() => store.quit()}>{tm(lang, "nav.quit")}</Button>
    </div>
  </div>
{/if}

{#if store.trayHint}
  <Dialog title={tm(lang, "dialog.tray.title")} oncancel={() => (store.trayHint = false)}>
    <p>{tm(lang, "dialog.tray.body", { near: hotkeys.near, far: hotkeys.far })}</p>
    {#snippet actions()}
      <Button onclick={() => store.quit()}>{tm(lang, "nav.quit")}</Button>
      <Button variant="primary" data-focus onclick={() => store.hideToTray()}>{tm(lang, "dialog.tray.ok")}</Button>
    {/snippet}
  </Dialog>
{/if}

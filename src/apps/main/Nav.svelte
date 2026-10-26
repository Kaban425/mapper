<script lang="ts">
  // Side navigation (plan/ux.md §6.3): one Tab stop (the open screen), ↑/↓ move the focus
  // between items, Enter opens.
  import type { Language } from "../../lib/core/types";
  import { tm, type MainKey } from "../../lib/i18n/main";
  import type { Screen } from "./store.svelte";

  let { lang, current, onselect }: { lang: Language; current: Screen; onselect: (screen: Screen) => void } = $props();

  const items: readonly { readonly screen: Screen; readonly key: MainKey; readonly shortcut: string }[] = [
    { screen: "home", key: "nav.home", shortcut: "Ctrl+1" },
    { screen: "settings", key: "nav.settings", shortcut: "Ctrl+2" },
    { screen: "about", key: "nav.about", shortcut: "Ctrl+3" },
  ];

  let buttons: HTMLButtonElement[] = $state([]);

  function onkeydown(event: KeyboardEvent, index: number): void {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    buttons[(index + step + items.length) % items.length]?.focus();
  }
</script>

<nav aria-label={tm(lang, "nav.label")}>
  <ul>
    {#each items as item, i (item.screen)}
      <li>
        <button
          bind:this={buttons[i]}
          type="button"
          aria-current={item.screen === current ? "page" : undefined}
          aria-keyshortcuts={item.shortcut}
          tabindex={item.screen === current ? 0 : -1}
          onclick={() => onselect(item.screen)}
          onkeydown={(e) => onkeydown(e, i)}>{tm(lang, item.key)}</button
        >
      </li>
    {/each}
  </ul>
</nav>

<style>
  ul {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button {
    width: 100%;
    min-height: 36px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-2);
    font: 400 14px/20px var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  button:hover {
    background: var(--glass-1);
    color: var(--text);
  }

  [aria-current="page"] {
    background: var(--glass-2);
    color: var(--text);
    font-weight: 600;
    box-shadow: inset 3px 0 0 var(--accent);
  }

  @media (forced-colors: active) {
    [aria-current="page"] {
      outline: 2px solid Highlight;
    }
  }
</style>

<script lang="ts">
  // Buttons of the main window (plan/ux.md §2.5): 32 px, the primary one 36 px in accent yellow.
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  let {
    variant = "secondary",
    ref = $bindable(),
    children,
    ...rest
  }: {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    /** The element, for callers that move the focus to it. */
    ref?: HTMLButtonElement | undefined;
    children: Snippet;
  } & HTMLButtonAttributes = $props();
</script>

<button bind:this={ref} type="button" class="btn {variant}" {...rest}>{@render children()}</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 14px;
    border: 1px solid var(--glass-edge);
    border-radius: var(--r-sm);
    background: var(--glass-1);
    color: var(--text);
    font: 600 14px/20px var(--font-ui);
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease),
      border-color var(--dur-fast) var(--ease);
  }

  .btn:hover:not(:disabled, [aria-disabled="true"]) {
    background: var(--glass-2);
  }

  .btn:active:not(:disabled) {
    transform: translateY(1px);
  }

  .btn:disabled,
  .btn[aria-disabled="true"] {
    cursor: default;
    opacity: 0.5;
  }

  .primary {
    min-height: 36px;
    padding: 0 18px;
    border-color: transparent;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: var(--sheen-top);
  }

  .primary:hover:not(:disabled, [aria-disabled="true"]) {
    background: #ffbb1f;
  }

  .ghost {
    border-color: transparent;
    background: transparent;
    color: var(--accent-text);
  }

  .ghost:hover:not(:disabled) {
    background: var(--glass-1);
  }

  .danger {
    color: var(--danger);
  }

  @media (forced-colors: active) {
    .btn {
      border-color: ButtonText;
      background: ButtonFace;
      color: ButtonText;
    }
  }
</style>

<script lang="ts">
  // A modal dialog (plan/ux.md M-7): native <dialog> with showModal(), so focus stays inside
  // and Esc cancels. The button marked `data-focus` gets the focus first ("Cancel" for resets).
  import type { Snippet } from "svelte";

  let {
    title,
    oncancel,
    children,
    actions,
  }: { title: string; oncancel: () => void; children: Snippet; actions: Snippet } = $props();

  const id = $props.id();
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-focus]")?.focus();
    return () => dialog?.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="{id}-title"
  oncancel={(e) => {
    e.preventDefault();
    oncancel();
  }}
>
  <h2 id="{id}-title">{title}</h2>
  <div class="body">{@render children()}</div>
  <div class="actions">{@render actions()}</div>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 48px));
    padding: 24px;
    border: 1px solid var(--glass-edge);
    border-radius: var(--r-md);
    background: #1a1d22;
    color: var(--text);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
  }

  h2 {
    margin: 0 0 12px;
    font: 600 16px/22px var(--font-ui);
  }

  .body {
    color: var(--text-2);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 20px;
  }
</style>

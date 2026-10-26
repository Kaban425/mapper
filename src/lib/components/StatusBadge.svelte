<script lang="ts">
  // A status is a shape plus a word, never colour alone (plan/ux.md §7): a tick in a circle,
  // an empty circle while waiting, a triangle for warnings and errors.
  import type { Snippet } from "svelte";

  let {
    kind,
    alert = false,
    children,
  }: { kind: "ok" | "wait" | "warn" | "error"; alert?: boolean; children: Snippet } = $props();
</script>

<p class="badge {kind}" role={alert ? "alert" : "status"}>
  <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    {#if kind === "ok"}
      <circle cx="8" cy="8" r="7" />
      <path d="M4.6 8.3 7 10.6l4.4-4.9" />
    {:else if kind === "wait"}
      <circle cx="8" cy="8" r="6.5" />
    {:else}
      <path d="M8 1.8 15 14H1z" />
      <path d="M8 6v3.6M8 11.6v.4" />
    {/if}
  </svg>
  <span>{@render children()}</span>
</p>

<style>
  .badge {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    font: 600 14px/20px var(--font-ui);
  }

  .icon {
    flex: none;
    margin-top: 2px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .ok .icon {
    color: var(--ok);
  }

  .wait {
    color: var(--text-2);
  }

  .warn {
    color: var(--warn);
  }

  .error {
    color: var(--danger);
  }
</style>

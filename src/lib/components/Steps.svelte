<script lang="ts">
  // Wizard progress (1)—(2)—(3)—(4): done steps filled, the current one ringed, words below.
  let { current, labels, title }: { current: number; labels: readonly string[]; title: string } = $props();
</script>

<ol class="steps" aria-label={title}>
  {#each labels as label, i (label)}
    {@const n = i + 1}
    <li class:done={n < current} class:current={n === current} aria-current={n === current ? "step" : undefined}>
      <span class="dot num" aria-hidden="true">{n}</span>
      <span class="label">{label}</span>
    </li>
  {/each}
</ol>

<style>
  .steps {
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 4px;
    width: 72px;
    color: var(--text-3);
    font: 400 12px/16px var(--font-ui);
  }

  /* The line to the previous step. */
  li + li::before {
    content: "";
    position: absolute;
    top: 12px;
    right: 50%;
    width: 100%;
    height: 2px;
    background: rgba(255, 255, 255, 0.14);
  }

  li.done + li::before,
  li.current::before {
    background: var(--accent);
  }

  .dot {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    background: var(--bg-solid);
    font-size: 12px;
  }

  .done .dot {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }

  .current .dot {
    border-color: var(--accent);
    color: var(--text);
  }

  .current .label {
    color: var(--text);
  }
</style>

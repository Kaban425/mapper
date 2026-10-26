<script lang="ts" generics="T extends string">
  // A small radio group shown as segments (language, monitor mode). Arrow keys move the choice.
  let {
    label,
    options,
    value,
    onchange,
  }: {
    label: string;
    options: readonly { readonly value: T; readonly label: string }[];
    value: T;
    onchange: (value: T) => void;
  } = $props();

  let buttons: HTMLButtonElement[] = $state([]);

  function onkeydown(event: KeyboardEvent, index: number): void {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    buttons[next]?.focus();
    onchange(options[next]!.value);
  }
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as option, i (option.value)}
    <button
      bind:this={buttons[i]}
      type="button"
      role="radio"
      aria-checked={option.value === value}
      tabindex={option.value === value ? 0 : -1}
      onclick={() => onchange(option.value)}
      onkeydown={(e) => onkeydown(e, i)}>{option.label}</button
    >
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--glass-edge);
    border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.2);
  }

  button {
    min-height: 28px;
    padding: 0 14px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text-2);
    font: 600 14px/20px var(--font-ui);
    cursor: pointer;
  }

  [aria-checked="true"] {
    background: var(--glass-2);
    color: var(--text);
    box-shadow: var(--sheen-top);
  }

  @media (forced-colors: active) {
    [aria-checked="true"] {
      outline: 2px solid Highlight;
    }
  }
</style>

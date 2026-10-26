<script lang="ts">
  // A range input with its value in words for Narrator (aria-valuetext). Saved when released
  // or after a keyboard step, not on every pixel of a drag.
  let {
    label,
    value,
    min = 0,
    max = 100,
    step = 1,
    valueText,
    oninput,
    onchange,
  }: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    valueText: string;
    /** While dragging: for a live preview. */
    oninput?: (value: number) => void;
    onchange: (value: number) => void;
  } = $props();

  const id = $props.id();
</script>

<div class="slider">
  <label for="{id}-range">{label}</label>
  <input
    id="{id}-range"
    type="range"
    {min}
    {max}
    {step}
    {value}
    aria-valuetext={valueText}
    oninput={(e) => oninput?.(Number(e.currentTarget.value))}
    onchange={(e) => onchange(Number(e.currentTarget.value))}
  />
  <output for="{id}-range" class="num">{valueText}</output>
</div>

<style>
  .slider {
    display: grid;
    grid-template-columns: minmax(0, 240px) minmax(0, 260px) auto;
    align-items: center;
    gap: 16px;
  }

  input {
    width: 100%;
    accent-color: var(--accent);
  }

  output {
    min-width: 48px;
    color: var(--text-2);
  }
</style>

<script lang="ts">
  // A number setting saved on Enter or when focus leaves (plan/ux.md M-6). A value out of range
  // is not sent: the error shows under the field with aria-invalid, and the old value stays.
  import type { Language } from "../core/types";

  let {
    label,
    value,
    min,
    max,
    lang,
    rangeText,
    error = null,
    onsave,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    lang: Language;
    /** "From 3 to 10". */
    rangeText: string;
    /** A refusal from Rust (already in words). */
    error?: string | null;
    onsave: (value: number) => void;
  } = $props();

  const id = $props.id();
  const format = (v: number) => new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 2, useGrouping: false }).format(v);

  let text = $state("");
  let local = $state<string | null>(null);
  $effect.pre(() => {
    text = format(value);
  });

  /** Both "6,3" and "6.3" are accepted whatever the language. */
  const parse = (input: string): number => Number(input.trim().replace(",", "."));

  function commit(): void {
    local = null;
    const parsed = parse(text);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      local = rangeText;
      return;
    }
    local = null;
    if (parsed !== value) onsave(parsed);
    else text = format(value);
  }

  const shown = $derived(local ?? error);
</script>

<div class="field">
  <label for="{id}-input">{label}</label>
  <input
    id="{id}-input"
    class="num"
    type="text"
    inputmode="decimal"
    bind:value={text}
    aria-invalid={shown ? "true" : undefined}
    aria-describedby="{id}-range"
    onkeydown={(e) => e.key === "Enter" && commit()}
    onblur={commit}
  />
  <p id="{id}-range" class:error={shown} class="hint">{shown ?? rangeText}</p>
</div>

<style>
  .field {
    display: grid;
    grid-template-columns: minmax(0, 240px) 96px;
    align-items: center;
    column-gap: 16px;
    row-gap: 2px;
  }

  label {
    color: var(--text);
  }

  input {
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--glass-edge);
    border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.25);
    color: var(--text);
    font-size: 14px;
    user-select: text;
  }

  input[aria-invalid="true"] {
    border-color: var(--danger);
  }

  .hint {
    grid-column: 2 / span 1;
    margin: 0;
    color: var(--text-3);
    font: 400 12px/16px var(--font-ui);
    white-space: nowrap;
  }

  .hint.error {
    color: var(--danger);
  }
</style>

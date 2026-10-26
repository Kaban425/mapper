<script lang="ts">
  // On/off switch: role="switch" with aria-checked (plan/ux.md §7); the label is the button.
  let {
    checked,
    label,
    description,
    disabled = false,
    onchange,
  }: {
    checked: boolean;
    label: string;
    description?: string;
    disabled?: boolean;
    onchange: (checked: boolean) => void;
  } = $props();

  const id = $props.id();
</script>

<div class="toggle">
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-describedby={description ? `${id}-hint` : undefined}
    {disabled}
    onclick={() => onchange(!checked)}
  >
    <span class="track" aria-hidden="true"><span class="thumb"></span></span>
    <span class="label">{label}</span>
  </button>
  {#if description}<p class="hint" id="{id}-hint">{description}</p>{/if}
</div>

<style>
  .toggle {
    display: grid;
    gap: 4px;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0;
    border: 0;
    background: none;
    color: var(--text);
    font: 400 14px/20px var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .track {
    flex: none;
    position: relative;
    width: 40px;
    height: 22px;
    border: 1px solid var(--glass-edge);
    border-radius: var(--r-pill);
    background: rgba(255, 255, 255, 0.08);
    transition: background var(--dur-fast) var(--ease);
  }

  .thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text-2);
    transition: transform var(--dur-fast) var(--ease);
  }

  [aria-checked="true"] .track {
    border-color: transparent;
    background: var(--accent);
  }

  [aria-checked="true"] .thumb {
    background: var(--accent-ink);
    transform: translateX(18px);
  }

  .hint {
    margin: 0 0 0 52px;
    color: var(--text-3);
    font: 400 13px/18px var(--font-ui);
  }

  @media (forced-colors: active) {
    .track {
      border-color: ButtonText;
    }

    [aria-checked="true"] .track {
      background: Highlight;
    }
  }
</style>

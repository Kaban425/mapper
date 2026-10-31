<script lang="ts">
  // Settings (plan/ux.md M-6): one page, everything saved at once; numbers on Enter or blur,
  // a refused value stays unsaved with the reason under the field.
  import Button from "../../../lib/components/Button.svelte";
  import NumberField from "../../../lib/components/NumberField.svelte";
  import Segmented from "../../../lib/components/Segmented.svelte";
  import Slider from "../../../lib/components/Slider.svelte";
  import StatusBadge from "../../../lib/components/StatusBadge.svelte";
  import Toggle from "../../../lib/components/Toggle.svelte";
  import { formatNumber } from "../../../lib/core/format";
  import type { Language } from "../../../lib/core/types";
  import { tm } from "../../../lib/i18n/main";
  import type { AppSnapshot } from "../../../lib/ipc/types";
  import type { MainKey } from "../../../lib/i18n/main";
  import type { IpcErrorCode } from "../../../lib/ipc/commands";
  import HotkeyRow from "../HotkeyRow.svelte";
  import { errorKey, type MainStore } from "../store.svelte";
  import { opacityFromPercent, transparencyPercent, updateLine } from "../view";

  let { store, snapshot }: { store: MainStore; snapshot: AppSnapshot } = $props();

  // The config ranges (eng §6): Rust refuses anything else.
  const SPRINT = { min: 3, max: 10 };
  const DACIA = { min: 20, max: 200 };

  const lang = $derived(snapshot.settings.language);
  const settings = $derived(snapshot.settings);
  const pinnedName = $derived(settings.monitor.mode === "pinned" ? settings.monitor.pinned.name : null);
  let preview = $state<number | null>(null);
  const transparency = $derived(preview ?? transparencyPercent(settings.panelOpacity));
  const line = $derived(updateLine(lang, snapshot.update));

  const languages: readonly { value: Language; label: string }[] = [
    { value: "ru", label: "Русский" },
    { value: "en", label: "English" },
  ];

  const range = (r: { min: number; max: number }) =>
    tm(lang, "settings.speed.range", { min: formatNumber(r.min, lang), max: formatNumber(r.max, lang) });

  let defaultsRefused = $state(false);
  let speedErrors = $state<{ sprint: string | null; dacia: string | null }>({ sprint: null, dacia: null });

  /** Alt+Q / Alt+W back, both at once in Rust (a swapped pair cannot come back one by one). */
  async function defaults(): Promise<void> {
    defaultsRefused = (await store.resetHotkeys()) === "hotkey_busy";
  }

  /** A value Rust refused stays in the field with the reason under it. */
  const refusal = (code: IpcErrorCode | null, rangeText: string): string | null => {
    if (code === null) return null;
    const key: MainKey | null = code === "invalid_input" ? null : errorKey(code);
    return key ? tm(lang, key) : rangeText;
  };

  async function saveSprint(sprintMps: number): Promise<void> {
    speedErrors = { ...speedErrors, sprint: refusal(await store.update({ sprintMps }), range(SPRINT)) };
  }

  async function saveDacia(daciaKmh: number): Promise<void> {
    speedErrors = { ...speedErrors, dacia: refusal(await store.update({ daciaKmh }), range(DACIA)) };
  }

  function pinFirst(): void {
    const display = snapshot.displays.find((d) => d.primary) ?? snapshot.displays[0];
    if (display) void store.update({ monitor: { mode: "pinned", name: display.name } });
  }

  async function saveOpacity(percent: number): Promise<void> {
    await store.update({ panelOpacity: opacityFromPercent(percent) });
    preview = null;
  }

  const displayLabel = (index: number, label: string, primary: boolean) =>
    `${tm(lang, "settings.monitor.n", { n: index + 1 })} · ${label}${primary ? ` · ${tm(lang, "home.monitor.primary")}` : ""}`;
</script>

<div class="screen">
  <h1 tabindex="-1">{tm(lang, "settings.title")}</h1>

  <section class="group" aria-labelledby="set-hotkeys">
    <h2 id="set-hotkeys">{tm(lang, "settings.hotkeys")}</h2>
    <HotkeyRow {store} {snapshot} preset="near" label={tm(lang, "settings.hotkey.near")} />
    <HotkeyRow {store} {snapshot} preset="far" label={tm(lang, "settings.hotkey.far")} />
    <p class="muted note">{tm(lang, "settings.hotkey.altNote")}</p>
    <div class="row"><Button onclick={defaults}>{tm(lang, "settings.hotkey.defaults")}</Button></div>
    {#if defaultsRefused}<StatusBadge kind="warn" alert>{tm(lang, "settings.hotkey.defaultsBusy")}</StatusBadge>{/if}
  </section>

  <section class="group" aria-labelledby="set-language">
    <h2 id="set-language">{tm(lang, "settings.language")}</h2>
    <Segmented label={tm(lang, "settings.language")} options={languages} value={lang} onchange={(language) => store.update({ language })} />
  </section>

  <section class="group" aria-labelledby="set-speeds">
    <h2 id="set-speeds">{tm(lang, "settings.speeds")}</h2>
    <div class="row">
      <NumberField
        label={tm(lang, "settings.speed.run")}
        value={settings.speeds.sprintMps}
        min={SPRINT.min}
        max={SPRINT.max}
        {lang}
        rangeText={range(SPRINT)}
        error={speedErrors.sprint}
        onsave={saveSprint}
      />
      <span class="muted">{tm(lang, "settings.speed.source")}</span>
    </div>
    <div class="row">
      <NumberField
        label={tm(lang, "settings.speed.dacia")}
        value={settings.speeds.daciaKmh}
        min={DACIA.min}
        max={DACIA.max}
        {lang}
        rangeText={range(DACIA)}
        error={speedErrors.dacia}
        onsave={saveDacia}
      />
      {#if !settings.speeds.daciaVerified}<StatusBadge kind="warn">{tm(lang, "settings.speed.unverified")}</StatusBadge>{/if}
    </div>
    <div class="row"><Button onclick={() => store.update({ resetSpeeds: true })}>{tm(lang, "settings.speed.reset")}</Button></div>
  </section>

  <section class="group" aria-labelledby="set-panels">
    <h2 id="set-panels">{tm(lang, "settings.panels")}</h2>
    <Slider
      label={tm(lang, "settings.opacity")}
      value={transparency}
      valueText={`${transparency} %`}
      oninput={(v) => (preview = v)}
      onchange={saveOpacity}
    />
    <div class="samples" aria-label={tm(lang, "settings.sample")} role="img">
      {#each ["light", "dark"] as ground (ground)}
        <div class="ground {ground}">
          <div class="sample" style:--ov-alpha={opacityFromPercent(transparency)}>
            <span class="sample-kicker">{tm(lang, "settings.sample")}</span>
            <span class="sample-number num">412 {lang === "ru" ? "м" : "m"}</span>
          </div>
        </div>
      {/each}
    </div>
    <p class="muted">{tm(lang, "settings.opacity.hint")}</p>
  </section>

  <section class="group" aria-labelledby="set-monitor">
    <h2 id="set-monitor">{tm(lang, "settings.monitor")}</h2>
    <div class="row">
      <Segmented
        label={tm(lang, "settings.monitor")}
        options={[
          { value: "cursor", label: tm(lang, "settings.monitor.cursor") },
          { value: "pinned", label: tm(lang, "settings.monitor.pinned") },
        ]}
        value={settings.monitor.mode}
        onchange={(mode) => (mode === "cursor" ? store.update({ monitor: { mode: "cursor" } }) : pinFirst())}
      />
      {#if settings.monitor.mode === "pinned"}
        <select
          aria-label={tm(lang, "settings.monitor.pinned")}
          value={pinnedName ?? ""}
          onchange={(e) => store.update({ monitor: { mode: "pinned", name: e.currentTarget.value } })}
        >
          {#if snapshot.pinnedMissing && pinnedName}
            <option value={pinnedName} disabled>{pinnedName} · {tm(lang, "home.monitor.unplugged")}</option>
          {/if}
          {#each snapshot.displays as d, i (d.name)}<option value={d.name}>{displayLabel(i, d.label, d.primary)}</option>{/each}
        </select>
      {/if}
    </div>
    {#if snapshot.pinnedMissing}<StatusBadge kind="warn">{tm(lang, "home.pinnedMissing")}</StatusBadge>{/if}
  </section>

  <section class="group" aria-labelledby="set-system">
    <h2 id="set-system">{tm(lang, "settings.system")}</h2>
    <Toggle
      checked={snapshot.autostart.enabled}
      label={tm(lang, "settings.startup")}
      onchange={(enabled) => store.setAutostart(enabled)}
    />
    {#if snapshot.autostart.enabled && !snapshot.autostart.approvedByWindows}
      <StatusBadge kind="warn">{tm(lang, "settings.startup.blocked")}</StatusBadge>
    {/if}
    <Toggle
      checked={settings.updatesEnabled}
      label={tm(lang, "settings.updates")}
      description={tm(lang, "settings.updates.hint")}
      onchange={(updatesEnabled) => store.update({ updatesEnabled })}
    />
    <div class="row update">
      <p class="muted" class:warn={line.warn} role="status">{line.text}</p>
      {#if snapshot.update.state !== "noRepository"}
        <Button disabled={snapshot.update.state === "checking"} onclick={() => store.checkUpdate()}>
          {tm(lang, "settings.updates.now")}
        </Button>
      {/if}
    </div>
    <div class="row">
      <Button onclick={() => store.update({ firstRunDone: false, wizardStep: 1 })}>{tm(lang, "settings.rerunWizard")}</Button>
    </div>
  </section>
</div>

<style>
  .group {
    display: grid;
    justify-items: start;
    gap: 14px;
    padding-bottom: 22px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .note {
    max-width: 640px;
  }

  .update {
    margin-left: 52px;
  }

  .warn {
    color: var(--warn);
  }

  select {
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--glass-edge);
    border-radius: var(--r-sm);
    background: #1a1d22;
    color: var(--text);
    font: inherit;
  }

  .samples {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  /* Neutral grounds, no game images: how the glass reads over light and dark map areas. */
  .ground {
    padding: 14px;
    border-radius: var(--r-md);
  }

  .ground.light {
    background: repeating-linear-gradient(45deg, #d9d4c4 0 10px, #c9c3b0 10px 20px);
  }

  .ground.dark {
    background: repeating-linear-gradient(45deg, #2b3a2c 0 10px, #223024 10px 20px);
  }

  .sample {
    display: grid;
    gap: 2px;
    width: 170px;
    padding: 10px 14px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--r-lg);
    background: rgba(14, 16, 20, var(--ov-alpha));
    box-shadow: var(--shadow-panel), var(--sheen-top);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
  }

  .sample-kicker {
    color: var(--accent-text);
    font: 700 11px/14px var(--font-ui);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .sample-number {
    color: var(--accent);
    font: 600 22px/28px var(--font-num);
  }
</style>

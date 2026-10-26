<script lang="ts">
  // First-run wizard (plan/ux.md M-1…M-4, §6.2). The step lives in the config, so closing the
  // window and coming back continues where the player left. Enter = Next (unless the focus is
  // on a button, link or checkbox), Alt+← = Back, Esc does nothing (this is not a dialog).
  import Button from "../../../lib/components/Button.svelte";
  import Steps from "../../../lib/components/Steps.svelte";
  import { tm } from "../../../lib/i18n/main";
  import type { AppSnapshot } from "../../../lib/ipc/types";
  import type { MainStore } from "../store.svelte";
  import { wizardReady } from "../view";
  import StepHow from "./wizard/StepHow.svelte";
  import StepMode from "./wizard/StepMode.svelte";
  import StepRisk from "./wizard/StepRisk.svelte";
  import StepScales from "./wizard/StepScales.svelte";

  let { store, snapshot }: { store: MainStore; snapshot: AppSnapshot } = $props();

  const lang = $derived(snapshot.settings.language);
  const step = $derived(snapshot.settings.wizardStep);
  const canNext = $derived(step !== 2 || snapshot.settings.riskAccepted);
  const ready = $derived(wizardReady(snapshot));
  let heading: HTMLHeadingElement | undefined = $state();

  // A new step: the reader starts at its heading.
  $effect(() => {
    void step;
    heading?.focus();
  });

  const go = (n: number) => store.update({ wizardStep: n });

  /** "Done" and "Set up later" lead to Home (F-1), also after "show the introduction again". */
  async function finish(): Promise<void> {
    store.screen = "home";
    await store.update({ firstRunDone: true });
  }

  function next(): void {
    if (step < 4 && canNext) void go(step + 1);
    else if (step === 4 && ready) void finish();
  }

  function onkeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    // A dialog over the wizard owns the keys.
    if (store.trayHint || target?.closest("dialog")) return;
    if (event.altKey && event.key === "ArrowLeft" && step > 1) {
      event.preventDefault();
      void go(step - 1);
      return;
    }
    const ownEnter = target?.closest("button, a, input, select, textarea, summary");
    if (event.key === "Enter" && !event.ctrlKey && !event.altKey && !ownEnter) {
      event.preventDefault();
      next();
    }
  }

  const labels = $derived([
    tm(lang, "wizard.steps.how"),
    tm(lang, "wizard.steps.risk"),
    tm(lang, "wizard.steps.mode"),
    tm(lang, "wizard.steps.scale"),
  ]);
</script>

<svelte:window {onkeydown} />

<div class="wizard">
  <header>
    <div class="brand">
      <span class="logo" aria-hidden="true"></span>
      <div>
        <p class="name">Mapper</p>
        <p class="subtitle">{tm(lang, "app.subtitle")}</p>
      </div>
    </div>
    <Steps current={step} {labels} title={tm(lang, "wizard.step", { n: step })} />
  </header>

  <main class="body screen">
    {#if store.error}<p class="banner error" role="alert">{tm(lang, store.error)}</p>{/if}
    {#each snapshot.notices as notice (notice)}
      <p class="banner warn" role="status">{tm(lang, `notice.${notice}`)}</p>
    {/each}
    {#if step === 1}
      <StepHow {store} {snapshot} bind:heading />
    {:else if step === 2}
      <StepRisk {store} {snapshot} bind:heading />
    {:else if step === 3}
      <StepMode {snapshot} bind:heading />
    {:else}
      <StepScales {store} {snapshot} bind:heading />
    {/if}
  </main>

  <footer>
    {#if step > 1}
      <Button onclick={() => go(step - 1)}>{tm(lang, "wizard.back")}</Button>
    {/if}
    <span class="spacer"></span>
    {#if step === 2 && !canNext}
      <span class="hint" id="wizard-next-hint">{tm(lang, "risk.ackNeeded")}</span>
    {/if}
    {#if step === 4}
      <Button variant="ghost" onclick={finish}>{tm(lang, "wizard.later")}</Button>
      <!-- aria-disabled, not disabled: keyboard users can still reach the button and its hint. -->
      <Button variant="primary" aria-disabled={!ready} onclick={() => ready && finish()}>{tm(lang, "wizard.done")}</Button>
    {:else}
      <Button
        variant="primary"
        aria-disabled={!canNext}
        aria-describedby={canNext ? undefined : "wizard-next-hint"}
        onclick={next}>{tm(lang, "wizard.next")}</Button
      >
    {/if}
  </footer>
</div>

<style>
  .wizard {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100vh;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 32px 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .body {
    align-content: start;
    padding: 24px 32px;
    min-width: 0;
    max-width: none;
    overflow-y: auto;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 32px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.18);
  }

  .spacer {
    flex: 1;
  }

  footer {
    flex-wrap: wrap;
  }

  @media (max-width: 640px) {
    header,
    .body,
    footer {
      padding-left: 16px;
      padding-right: 16px;
    }
  }

  .hint {
    color: var(--text-3);
    font: 400 13px/18px var(--font-ui);
  }
</style>

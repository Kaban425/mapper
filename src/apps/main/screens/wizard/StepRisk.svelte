<script lang="ts">
  // Wizard step 2 (plan/ux.md M-2): does / doesn't, the one risk text, and the checkbox that
  // Next waits for. The tick is remembered in the config.
  import { tm } from "../../../../lib/i18n/main";
  import type { AppSnapshot } from "../../../../lib/ipc/types";
  import DoesList from "../../DoesList.svelte";
  import RiskNotice from "../../RiskNotice.svelte";
  import type { MainStore } from "../../store.svelte";

  let {
    store,
    snapshot,
    heading = $bindable(),
  }: { store: MainStore; snapshot: AppSnapshot; heading?: HTMLHeadingElement | undefined } = $props();

  const lang = $derived(snapshot.settings.language);
</script>

<h1 bind:this={heading} tabindex="-1">{tm(lang, "wizard.risk.title")}</h1>
<DoesList {lang} />
<RiskNotice {lang} />
<div class="row ack">
  <label>
    <input
      type="checkbox"
      checked={snapshot.settings.riskAccepted}
      onchange={async (e) => {
        const box = e.currentTarget;
        // Not saved: the box shows what Rust holds, so it never looks ticked while Next stays off.
        if ((await store.update({ riskAccepted: box.checked })) !== null) box.checked = snapshot.settings.riskAccepted;
      }}
    />
    {tm(lang, "risk.ack")}
  </label>
  <button type="button" class="link" onclick={() => store.open("risk")}>{tm(lang, "risk.more")}</button>
</div>
<p class="muted">{tm(lang, "about.affiliation")}</p>

<style>
  .ack {
    justify-content: space-between;
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    cursor: pointer;
  }

  input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
</style>

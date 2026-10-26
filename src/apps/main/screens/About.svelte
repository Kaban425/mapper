<script lang="ts">
  // About (plan/ux.md M-6b, US-17): version, licence, links, does / doesn't, the same risk
  // text as the wizard, and where Mapper keeps its files.
  import Button from "../../../lib/components/Button.svelte";
  import { tm, type MainKey } from "../../../lib/i18n/main";
  import type { AppSnapshot, Link } from "../../../lib/ipc/types";
  import DoesList from "../DoesList.svelte";
  import RiskNotice from "../RiskNotice.svelte";
  import type { MainStore } from "../store.svelte";

  let { store, snapshot }: { store: MainStore; snapshot: AppSnapshot } = $props();

  const lang = $derived(snapshot.settings.language);
  const links: readonly { readonly link: Link; readonly key: MainKey }[] = [
    { link: "repo", key: "about.repo" },
    { link: "releases", key: "about.releases" },
    { link: "issues", key: "about.issues" },
    { link: "security", key: "about.security" },
  ];
</script>

<div class="screen">
  <h1 tabindex="-1">{tm(lang, "about.version", { v: snapshot.version })} · {tm(lang, "app.subtitle")}</h1>
  <p class="text">{tm(lang, "about.license")} {tm(lang, "about.affiliation")}</p>
  <div class="row">
    {#each links as item (item.link)}
      <Button onclick={() => store.open(item.link)}>{tm(lang, item.key)}</Button>
    {/each}
  </div>

  <DoesList {lang} />
  <RiskNotice {lang} />

  <section class="files" aria-labelledby="about-files">
    <h2 id="about-files">{tm(lang, "about.local")}</h2>
    <div class="row">
      <Button onclick={() => store.openFolder("config")}>{tm(lang, "about.openConfig")}</Button>
      <Button onclick={() => store.openFolder("logs")}>{tm(lang, "about.openLog")}</Button>
    </div>
  </section>
</div>

<style>
  .files {
    display: grid;
    gap: 12px;
  }

  .files h2 {
    font-weight: 400;
    color: var(--text-2);
  }
</style>

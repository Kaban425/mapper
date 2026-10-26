<script lang="ts">
  // "Mapper does / doesn't" (US-17): the same lists in wizard step 2, About and the README.
  import type { Language } from "../../lib/core/types";
  import { tm, type MainKey } from "../../lib/i18n/main";

  let { lang }: { lang: Language } = $props();

  const does: readonly MainKey[] = ["does.overlay", "does.points", "does.hotkeys", "does.focus", "does.cursor", "does.updates"];
  const doesnt: readonly MainKey[] = [
    "doesnt.memory",
    "doesnt.screen",
    "doesnt.input",
    "doesnt.window",
    "doesnt.admin",
    "doesnt.data",
  ];
</script>

<div class="lists">
  <section>
    <h2>{tm(lang, "does.title")}</h2>
    <ul class="does">
      {#each does as key (key)}<li>{tm(lang, key)}</li>{/each}
    </ul>
  </section>
  <section>
    <h2>{tm(lang, "doesnt.title")}</h2>
    <ul class="doesnt">
      {#each doesnt as key (key)}<li>{tm(lang, key)}</li>{/each}
    </ul>
  </section>
</div>

<style>
  .lists {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
    gap: 24px;
  }

  h2 {
    margin: 0 0 8px;
    font: 600 14px/20px var(--font-ui);
  }

  ul {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-2);
  }

  li {
    position: relative;
    padding-left: 22px;
  }

  /* Plus and minus marks: shape, not only colour. */
  li::before {
    position: absolute;
    left: 0;
    width: 16px;
    font: 700 14px/20px var(--font-num);
    text-align: center;
  }

  .does li::before {
    content: "+";
    color: var(--ok);
  }

  .doesnt li::before {
    content: "−";
    color: var(--text-3);
  }
</style>

<script lang="ts">
  import { logFailure, quitApp } from "../../lib/ipc/commands";

  // Phase 1 placeholder: proves the window, its glass background and the main-window ACL.
  let quitting = $state(false);

  async function quit(): Promise<void> {
    quitting = true;
    try {
      await quitApp();
    } catch (error) {
      quitting = false;
      await logFailure("quit_app", error);
    }
  }
</script>

<main>
  <section class="card">
    <p class="kicker">Mapper</p>
    <h1>Каркас приложения</h1>
    <p class="hint">
      Фаза 1: окна, трей и горячие клавиши. Главный экран, мастер и настройки появятся в фазе 3.
    </p>
    <button type="button" onclick={quit} disabled={quitting}>Выйти из Mapper</button>
  </section>
</main>

<style>
  main {
    display: grid;
    place-items: center;
    min-height: 100vh;
    padding: 32px;
    background: var(--bg-tint);
  }

  .card {
    width: min(520px, 100%);
    padding: 24px 28px;
    border-radius: var(--r-md);
    background: var(--glass-1);
    border: 1px solid var(--glass-edge);
    box-shadow: var(--shadow-card), var(--sheen-top);
  }

  .kicker {
    margin: 0;
    color: var(--accent-text);
    font: 700 13px/16px var(--font-ui);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  h1 {
    margin: 8px 0;
    font: 600 28px/34px var(--font-display);
  }

  .hint {
    margin: 0 0 20px;
    color: var(--text-3);
  }

  button {
    height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--accent);
    color: var(--accent-ink);
    font: 600 14px/20px var(--font-ui);
    cursor: pointer;
    transition: filter var(--dur-fast) var(--ease);
  }

  button:hover {
    filter: brightness(1.08);
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>

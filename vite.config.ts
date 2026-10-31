import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const src = resolve(import.meta.dirname, "src");

// Three entry points: each window loads only its own code (the HUD has no commands at all).
// `--mode e2e` swaps the Tauri transport for the in-memory mock the Playwright tests drive.
export default defineConfig(({ mode }) => ({
  root: src,
  // The root is src/, so the plugin would not find svelte.config.js on its own.
  plugins: [svelte({ configFile: resolve(import.meta.dirname, "svelte.config.js") })],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: { $transport: resolve(src, "lib/ipc", mode === "e2e" ? "mock.ts" : "tauri.ts") },
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    target: "es2023",
    sourcemap: false,
    // WebView2 preloads modules itself; the polyfill would bring `fetch` into the bundle.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        main: resolve(src, "main.html"),
        overlay: resolve(src, "overlay.html"),
        hud: resolve(src, "hud.html"),
      },
    },
  },
}));

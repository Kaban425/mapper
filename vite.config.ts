import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const src = resolve(import.meta.dirname, "src");

// Three entry points: each window loads only its own code (the HUD has no commands at all).
export default defineConfig({
  root: src,
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    target: "es2023",
    sourcemap: false,
    rolldownOptions: {
      input: {
        main: resolve(src, "main.html"),
        overlay: resolve(src, "overlay.html"),
        hud: resolve(src, "hud.html"),
      },
    },
  },
});

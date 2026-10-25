import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Compiles the runes in *.svelte.ts (the overlay controller) for its tests.
  plugins: [svelte({ configFile: resolve(import.meta.dirname, "svelte.config.js") })],
  // Unit tests never talk to Tauri.
  resolve: { alias: { $transport: resolve(import.meta.dirname, "src/lib/ipc/mock.ts") } },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/core/**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "html"],
      // eng §8: the measuring core must stay at 80 % or more (target 95 %).
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});

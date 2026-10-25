import { defineConfig } from "@playwright/test";

// End-to-end tests of the overlay and HUD pages against the in-memory mock transport
// (vite --mode e2e). They drive the installed Microsoft Edge, so no browser is downloaded;
// windows-latest runners have it too. Each test runs at three Windows scales.
const PORT = 5174;
// Explicit IPv4: "localhost" makes Vite listen on ::1 only, which the readiness check may miss.
const HOST = "127.0.0.1";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    channel: "msedge",
    baseURL: `http://${HOST}:${PORT}`,
    viewport: { width: 1600, height: 900 },
  },
  projects: [
    { name: "scale-100", use: { deviceScaleFactor: 1 } },
    { name: "scale-125", use: { deviceScaleFactor: 1.25 } },
    { name: "scale-150", use: { deviceScaleFactor: 1.5 } },
  ],
  webServer: {
    // --no: never download a package that is not installed; `--` keeps vite's flags away from npm.
    command: `npx --no -- vite --mode e2e --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}/overlay.html`,
    reuseExistingServer: !process.env.CI,
  },
});

import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

// Siempre una base de test: e2e/server.mjs la vacía y la vuelve a sembrar antes de levantar la app.
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5434/precios_test";
if (!/_test$/.test(new URL(DATABASE_URL).pathname)) {
  throw new Error(`Las e2e borran la base: ${DATABASE_URL} no parece una base de test (tiene que terminar en _test)`);
}
process.env.DATABASE_URL = DATABASE_URL;

// Un puerto libre, elegido una sola vez: los workers heredan E2E_PORT del proceso principal.
process.env.E2E_PORT ??= execFileSync(process.execPath, [
  "-e",
  "const s = require('net').createServer().listen(0, () => { console.log(s.address().port); s.close(); })",
])
  .toString()
  .trim();
const baseURL = `http://localhost:${process.env.E2E_PORT}`;

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", locale: "es-UY" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/server.mjs",
    url: baseURL,
    env: { DATABASE_URL, PORT: process.env.E2E_PORT },
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});

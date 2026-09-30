import { defineConfig } from "@playwright/test";
import { FAKE_MIC_WAV } from "./e2e/global-setup.js";

/**
 * E2E del flujo crítico contra un stack REAL (API + worker + PostgreSQL +
 * Redis) con la IA y la voz SIMULADAS (AI_PROVIDER=mock, VOICE_PROVIDER=mock).
 * El frontend se sirve con `vite preview` del BUILD: con su CSP y su Service
 * Worker, como en producción. Ver e2e/README.md (y scripts\e2e.bat).
 *
 * Micrófono: Chromium usa un micrófono FALSO que reproduce un audio generado
 * (e2e/global-setup.js) y concede el permiso sin preguntar. Todo lo demás es
 * real: AudioWorklet, WebSocket de voz y WebRTC entre dos contextos.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.js",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Un solo worker: los escenarios comparten la base de pruebas y el mismo backend.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:4175",
    // En local, el Chrome instalado (con un perfil temporal: no toca el tuyo); en CI, el Chromium de Playwright.
    channel: process.env.CI ? undefined : process.env.E2E_CHANNEL || "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-CO",
    reducedMotion: "reduce",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
});

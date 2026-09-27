import { defineConfig, devices } from "@playwright/test";

import { APP_ORIGIN, APP_PORT, MOCK_ORIGIN, MOCK_PORT } from "./e2e/origins";

export default defineConfig({
  testDir: "./e2e",
  // Specs share one in-memory mock and reset it, so they run one at a time.
  workers: 1,
  use: {
    baseURL: APP_ORIGIN,
    // Lets a machine use its installed Chromium instead of downloading
    // Playwright's browser build.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --dir mock-api start",
      url: `${MOCK_ORIGIN}/__mock/health`,
      env: { PORT: String(MOCK_PORT), APP_ORIGIN },
      timeout: 120_000,
    },
    {
      // The production build, run in development mode so dev login works.
      command: "pnpm build && pnpm start",
      url: APP_ORIGIN,
      env: {
        PORT: String(APP_PORT),
        APP_ENV: "development",
        DEV_LOGIN: "1",
        API_ORIGIN: MOCK_ORIGIN,
        APP_ORIGIN,
      },
      timeout: 120_000,
    },
  ],
});

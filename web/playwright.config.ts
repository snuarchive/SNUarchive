import { defineConfig, devices } from "@playwright/test";

import {
  API_ORIGIN,
  APP_ORIGIN,
  APP_PORT,
  MOCK_ORIGIN,
  MOCK_PORT,
  TARGET,
} from "./e2e/origins";

// See e2e/origins.ts for E2E_TARGET: which API the tests run against and
// what Playwright starts for it.
const mock = {
  command: "pnpm --dir mock-api start",
  url: `${MOCK_ORIGIN}/__mock/health`,
  env: { PORT: String(MOCK_PORT), APP_ORIGIN },
  timeout: 120_000,
};
const app = {
  // The production build, run in development mode so dev login works.
  command: "pnpm build && pnpm start",
  url: APP_ORIGIN,
  env: {
    PORT: String(APP_PORT),
    APP_ENV: "development",
    DEV_LOGIN: "1",
    API_ORIGIN,
    APP_ORIGIN,
  },
  timeout: 120_000,
};

export default defineConfig({
  testDir: "./e2e",
  // Specs share one data set and reset it, so they run one at a time.
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
  webServer:
    TARGET === "mock" ? [mock, app] : TARGET === "go" ? [app] : undefined,
});

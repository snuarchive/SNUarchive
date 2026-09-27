import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: the React Router plugin is for the app
// build and dev server, not for running tests.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    env: { APP_ENV: "development" },
  },
});

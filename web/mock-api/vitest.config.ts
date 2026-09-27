import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    // Building the catalog from the nine source files takes a few seconds.
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});

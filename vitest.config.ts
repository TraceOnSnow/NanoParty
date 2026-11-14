import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});

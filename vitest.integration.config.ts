import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["**/*integration.test.*"],
    testTimeout: 120000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/*.compat.test.*",
      "**/integration.test.*",
    ],
  },
});

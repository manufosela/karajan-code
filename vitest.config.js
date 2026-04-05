import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "node_modules/**",
      "packages/**",
      ".claude/**",
      ".kj/**",
      "demo/**"
    ],
    testTimeout: 30000
  }
});

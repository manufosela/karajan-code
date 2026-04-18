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
    setupFiles: ["./tests/setup.js"],
    testTimeout: 30000
  }
});

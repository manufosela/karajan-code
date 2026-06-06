// Local Vitest config for @karajan/ai-trash so the workspace package does not
// inherit the root config (which excludes `packages/**` and points at a global
// setup file outside the workspace).

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
  },
});

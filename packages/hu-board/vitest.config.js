import { defineConfig } from "vitest/config";

// Local config for the hu-board package. The root `vitest.config.js`
// excludes `packages/**` and expects a repo-wide `tests/setup.js` that
// does not apply here — this config scopes vitest to the hu-board tree
// and omits that setup file.

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    testTimeout: 15000,
  },
});

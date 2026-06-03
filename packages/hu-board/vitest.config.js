import { defineConfig } from "vitest/config";

// Local config for the hu-board package. The root `vitest.config.js`
// excludes `packages/**` and expects a repo-wide `tests/setup.js` that
// does not apply here — this config scopes vitest to the hu-board tree
// and omits that setup file.

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    testTimeout: 15000,
    // KJC-BUG-0075: same mtime-based purge as the root config — also
    // applies to the hu-board sub-package, which previously leaked its
    // own `karajan-vitest-*` tmp dirs from db.js::vitestTmpKjHome().
    globalSetup: ["../../tests/global-setup.js"],
    // Isolate sync.js from the developer's real ~/.kj/plans/ so tests
    // don't drown in real data. tests can still override KJ_PLANS_DIR
    // for scenarios that need to seed plans.
    env: {
      KJ_PLANS_DIR: "/tmp/.kj-plans-hu-board-test-placeholder",
    },
  },
});

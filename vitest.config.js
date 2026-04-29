import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest 4 dropped the built-in "basic" reporter. The FASE 2 acceptance gate
// shells out `npm test -- --reporter=basic`, so we alias the bare specifier
// `basic` to a local shim that re-exports DotReporter. See
// tests/_diet/basic-reporter.js for the rationale.
const basicReporterPath = fileURLToPath(
  new URL("./tests/_diet/basic-reporter.js", import.meta.url)
);

export default defineConfig({
  resolve: {
    alias: {
      basic: basicReporterPath
    }
  },
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

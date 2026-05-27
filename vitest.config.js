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
      basic: basicReporterPath,
    },
  },
  test: {
    exclude: ["node_modules/**", "packages/**", ".claude/**", ".kj/**", "demo/**"],
    setupFiles: ["./tests/setup.js"],
    // 120s default. Orchestrator integration tests (runflow-*, reviewer-*,
    // kj-run-smoke, subloop-limits) wire up multi-stage pipelines and can
    // take 60-90s under host contention even though each test passes in
    // ~5-15s in isolation. Use forks (not threads) because several config
    // tests call process.chdir(), which throws inside worker_threads.
    testTimeout: 120000,
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 6,
        minForks: 1,
      },
    },
    // Audit recommendation #7: per-directory coverage thresholds for the
    // areas the audit flagged as "large surfaces with no same-name test
    // file". Coverage isn't a CI gate yet (would block PRs unrelated to
    // these dirs); when run with `npx vitest run --coverage` the values
    // below are enforced only when the user explicitly opts in.
    //
    // Why `thresholds.perFile: false`: file-level thresholds are too
    // strict for a project this size; we want directory-level signal.
    coverage: {
      provider: "v8",
      // lcov added for CI artifact + Codecov-compatible tooling (KJC-TSK-0465).
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.js"],
      exclude: [
        "src/**/*.test.js",
        "src/cli.js", // the CLI entry — exercised by e2e
        "src/mcp/server.js", // long-running process, hard to unit
      ],
      thresholds: {
        // Per-glob targets reflect the audit's prioritisation:
        // - agents/ talk to LLM SDKs and have lots of branches → 80%
        // - mcp/handlers/ are the public RPC surface → 80%
        // - session/journal/ persists run state → 70% (lots of fs IO)
        "src/agents/**/*.js": { lines: 80, functions: 80 },
        "src/mcp/handlers/**/*.js": { lines: 80, functions: 80 },
        "src/session/journal/**/*.js": { lines: 70, functions: 70 },
        // Defaults for everything else: keep low so coverage runs are
        // useful as a signal without flipping into a blocking gate.
        lines: 40,
        functions: 40,
      },
    },
  },
});

/**
 * Test helper: spawn the kj CLI as a subprocess against an isolated
 * tmp project + tmp KJ_HOME. Captures stdout + stderr, enforces a
 * per-test timeout so a hung kj can never block the suite.
 *
 * The whole point of the e2e suite is to exercise the REAL CLI end
 * to end — no in-process imports of runFlow, no role mocks. The
 * agent layer is mocked at the binary level via the fake-coder
 * fixture (configured per-test via FAKE_CODER_SCRIPT env var).
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KJ_BIN = path.resolve(HERE, "..", "..", "..", "bin", "kj.js");

const FAKE_AGENT_PATH = path.resolve(HERE, "..", "fixtures", "fake-coder.js");

/**
 * @param {string[]} args   — kj arguments (e.g. ["plan", "generate", "--task-file", "X"])
 * @param {object} opts
 * @param {string} opts.cwd — working directory for the kj subprocess (the tmp project)
 * @param {string} [opts.kjHome] — KJ_HOME for the subprocess (defaults to opts.cwd + "/.karajan")
 * @param {Record<string,string>} [opts.env] — additional env vars (merged with process.env)
 * @param {number} [opts.timeoutMs=60000] — kill the subprocess after this many ms
 * @param {string} [opts.fixtureDir] — directory to read coder-script.json from (sets TEST_FIXTURE_DIR)
 * @param {boolean} [opts.fakeAgent=false] — preload the fake agent registration (NODE_OPTIONS --import)
 * @returns {{ exitCode: number, stdout: string, stderr: string, signal: string|null }}
 */
export function runKj(args, { cwd, kjHome, env = {}, timeoutMs = 60000, fixtureDir, fakeAgent = false } = {}) {
  if (!cwd) throw new Error("runKj: cwd is required");
  const homeForRun = kjHome || path.join(cwd, ".karajan");

  // To activate the fake agent registry we preload its module via
  // NODE_OPTIONS --import. This runs BEFORE bin/kj.js loads src/cli.js,
  // so by the time `createAgent("fake", ...)` is called the agent is
  // already in the registry. No source-tree modifications required.
  let nodeOptions = process.env.NODE_OPTIONS || "";
  if (fakeAgent) {
    // pathToFileURL ensures Windows + Linux both work
    const importUrl = `file://${FAKE_AGENT_PATH}`;
    nodeOptions = `${nodeOptions} --import="${importUrl}"`.trim();
  }

  const r = spawnSync(process.execPath, [KJ_BIN, ...args], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      // Strip CLAUDECODE so a Claude Code parent doesn't bleed into
      // the kj subprocess (per the workaround in CLAUDE.md).
      CLAUDECODE: undefined,
      KJ_HOME: homeForRun,
      KJ_PLANS_DIR: path.join(homeForRun, "plans"),
      // Suppress any TTY-driven prompts.
      CI: "1",
      // Skip side effects guarded by `process.env.VITEST` (auto-board
      // start, auto-GC). E2E tests assert filesystem state, not the
      // banner output.
      VITEST: "1",
      NODE_ENV: "test",
      // Tell the fake-coder where to read its script + write call log.
      ...(fixtureDir ? { TEST_FIXTURE_DIR: fixtureDir } : {}),
      ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}),
      // No real LLM calls — every coder/reviewer call must go through
      // the fake fixture set per test.
      ...env,
    },
  });
  return {
    exitCode: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    signal: r.signal,
  };
}

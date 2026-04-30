/**
 * Fake-coder agent — a Karajan-compatible agent that replays canned
 * responses from a JSON script. Used by the e2e suite to exercise the
 * real CLI end-to-end without spawning real LLM subprocesses
 * (claude / codex / gemini / aider / opencode).
 *
 * Activation:
 *   NODE_OPTIONS="--import=<absolute path to this file>" kj ...
 *
 * The fake registers an agent named "fake" via `registerAgent` so that
 * `--coder fake` / `--reviewer fake` / `--planner fake` resolve to it.
 * It does NOT register a CLI `bin`, which means `assertAgentsAvailable`
 * skips its --version probe (see src/agents/availability.js).
 *
 * Script contract (process.env.TEST_FIXTURE_DIR/coder-script.json):
 *   {
 *     "planner": { "output": "<JSON string of planner result>" },
 *     "coder":   { "output": "..." },
 *     "reviewer":{ "output": "<JSON string of reviewer result>" },
 *     "default": { "output": "ok" }
 *   }
 *
 * Each call increments a per-role counter so a script can return
 * different responses on iteration 0 vs 1 vs 2:
 *
 *   "reviewer": [ { output: "...rejected..." }, { output: "...approved..." } ]
 *
 * If a role's entry is missing the fake falls back to "default", and if
 * default is missing it returns a generic OK.
 *
 * Read-only with respect to the script file. The test injects a fresh
 * script per fixture dir; the fake never writes to it.
 */

import fs from "node:fs";
import path from "node:path";
import { registerAgent } from "../../../src/agents/index.js";
import { BaseAgent } from "../../../src/agents/base-agent.js";

// Disable extended preflight (openskills CLI probe, fs leak detector,
// chrome-devtools probe) for the kj subprocess. These are flaky under
// parallel test load — the openskills probe times out at 3s when CPU
// is saturated by 12 parallel vitest workers, which fails kj's run
// preflight gate and makes the test flaky.
//
// Same lever as tests/setup.js for in-process orchestrator tests, but
// applied here because the fake-coder is loaded inside the subprocess
// (via NODE_OPTIONS --import) BEFORE bin/kj.js. See:
// src/config/test-harness.js for the contract.
globalThis.__KJ_DEFAULT_PREFLIGHT_EXTENDED = false;

const COUNTERS = new Map();

function loadScript() {
  const fixtureDir = process.env.TEST_FIXTURE_DIR;
  if (!fixtureDir) return {};
  const scriptPath = path.join(fixtureDir, "coder-script.json");
  try {
    const raw = fs.readFileSync(scriptPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function recordCall(role, prompt) {
  const fixtureDir = process.env.TEST_FIXTURE_DIR;
  if (!fixtureDir) return;
  const callsPath = path.join(fixtureDir, "fake-calls.log");
  const line = JSON.stringify({
    role,
    iteration: COUNTERS.get(role) || 0,
    promptHead: String(prompt || "").slice(0, 200),
    ts: Date.now()
  });
  // Sync write so a chokidar / synchronous reader of the file sees
  // every event in order. Per CLAUDE.md guidance for e2e fixtures.
  try {
    fs.writeFileSync(callsPath, fs.existsSync(callsPath)
      ? `${fs.readFileSync(callsPath, "utf8")}${line}\n`
      : `${line}\n`);
  } catch { /* non-fatal */ }
}

function pickResponse(script, role) {
  const counter = COUNTERS.get(role) || 0;
  COUNTERS.set(role, counter + 1);

  let entry = script[role];
  if (entry === undefined) entry = script.default;
  if (Array.isArray(entry)) entry = entry[Math.min(counter, entry.length - 1)];
  if (entry === undefined) {
    return { ok: true, output: defaultOutputFor(role) };
  }
  if (typeof entry === "string") return { ok: true, output: entry };
  return {
    ok: entry.ok !== false,
    output: typeof entry.output === "string" ? entry.output : defaultOutputFor(role),
    error: entry.error || ""
  };
}

function defaultOutputFor(role) {
  if (role === "planner") {
    return JSON.stringify({
      approach: "Stub plan from fake-coder.",
      steps: [
        { description: "Stub step", commit: "feat: stub", spec_section: null, acceptance_tests: ["true"] }
      ],
      risks: [],
      outOfScope: []
    });
  }
  if (role === "reviewer" || role === "hu-reviewer") {
    return JSON.stringify({
      approved: true,
      blocking_issues: [],
      non_blocking_suggestions: [],
      summary: "Looks good (fake reviewer).",
      confidence: 0.95
    });
  }
  if (role === "triage") {
    return JSON.stringify({ level: "trivial", taskType: "sw", roles: [] });
  }
  if (role === "researcher") {
    return JSON.stringify({ files: [], patterns: [], constraints: [], risks: [] });
  }
  if (role === "architect") {
    return JSON.stringify({ architecture: { type: "stub", layers: [], patterns: [] }, summary: "Stub architecture.", verdict: "ready" });
  }
  return "Done (fake coder).";
}

class FakeAgent extends BaseAgent {
  async runTask(task) {
    const role = task?.role || "coder";
    const script = loadScript();
    recordCall(role, task?.prompt);
    const resp = pickResponse(script, role);
    return resp;
  }

  async reviewTask(task) {
    const role = task?.role || "reviewer";
    const script = loadScript();
    recordCall(role, task?.prompt);
    const resp = pickResponse(script, role);
    return resp;
  }
}

// `bin` is intentionally absent so assertAgentsAvailable skips the
// --version probe. installUrl is unused without a bin.
registerAgent("fake", FakeAgent, {});

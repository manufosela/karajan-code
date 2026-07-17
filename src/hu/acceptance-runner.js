/**
 * HU Acceptance Test Runner.
 * Executes acceptance_tests commands for an HU and returns structured results.
 * Brain uses this to determine if an HU is done (all pass) or needs fixing (with diagnostics).
 */
import { runCommand } from "../utils/process.js";

/**
 * Run a single acceptance test command.
 * @param {string} cmd - Shell command to execute
 * @param {string} cwd - Working directory
 * @param {number} [timeoutMs=30000] - Timeout per test
 * @returns {Promise<{cmd: string, passed: boolean, output: string, exitCode: number}>}
 */
async function runSingleTest(cmd, cwd, timeoutMs = 30000, env = null) {
  try {
    const result = await runCommand("bash", ["-c", cmd], {
      timeout: timeoutMs,
      cwd,
      // PAR-H (KJC-TSK-0631): lane env (KJ_LANE_SLOT / KJ_PORT_OFFSET) so
      // tests that start services can offset their ports. execa merges
      // this on top of process.env.
      ...(env ? { env } : {})
    });
    const output = (result.stdout || "") + (result.stderr || "");
    return {
      cmd,
      passed: result.exitCode === 0,
      output: output.slice(-500), // last 500 chars for diagnostics
      exitCode: result.exitCode
    };
  } catch (err) {
    return {
      cmd,
      passed: false,
      output: err.message?.slice(-500) || "Command timed out or crashed",
      exitCode: -1
    };
  }
}

/**
 * Run all acceptance tests for an HU.
 *
 * Accepts two shapes:
 *   - Legacy: plain string shell command.
 *   - v2.7.5: { type: "shell" | "gherkin", content, file? }
 *
 * Shell entries execute immediately (exit code 0 = pass). Gherkin entries
 * cannot be executed directly — that's Phase 3 of tests-first where the
 * tester role translates them into real code tests. Until then, we report
 * them as "pending" and skip rather than failing the whole gate.
 *
 * @param {Array<string|object>} tests - Array of shell commands OR structured entries
 * @param {string} cwd - Working directory
 * @returns {Promise<{allPassed: boolean, results: object[], summary: string, diagnostics: string|null, pending: number}>}
 */
export async function runAcceptanceTests(tests, cwd, { env = null } = {}) {
  if (!tests || tests.length === 0) {
    return { allPassed: false, results: [], summary: "No acceptance tests defined", diagnostics: null, pending: 0 };
  }

  const results = [];
  let pending = 0;
  for (const entry of tests) {
    let type = "shell";
    let cmd;
    if (typeof entry === "string") {
      cmd = entry;
    } else if (entry && typeof entry === "object" && typeof entry.content === "string") {
      type = entry.type === "gherkin" ? "gherkin" : "shell";
      cmd = entry.content;
    } else {
      results.push({ cmd: JSON.stringify(entry), passed: false, output: "Malformed acceptance_test entry", exitCode: -2, type: "invalid" });
      continue;
    }
    if (type === "gherkin") {
      // Gherkin entries need a translator (Phase 3). Mark them pending
      // so the coder/tester sees they haven't been validated yet —
      // better than silently passing (would lie) or hard-failing
      // (would block the whole pipeline).
      pending += 1;
      results.push({
        cmd,
        passed: false,
        output: "Gherkin test not yet executable (awaits tester translation — Phase 3)",
        exitCode: 0,
        type: "gherkin",
        pending: true,
      });
      continue;
    }
    const result = await runSingleTest(cmd, cwd, 30000, env);
    results.push({ ...result, type: "shell" });
  }

  const executedResults = results.filter((r) => !r.pending);
  const passed = executedResults.filter((r) => r.passed);
  const failed = executedResults.filter((r) => !r.passed);
  const allPassed = failed.length === 0;

  const shellSummary = `${passed.length}/${executedResults.length} shell tests passed`;
  const summary = pending > 0
    ? `${shellSummary}, ${pending} gherkin test(s) pending translation`
    : shellSummary;

  let diagnostics = null;
  if (!allPassed) {
    diagnostics = failed.map((f) =>
      `FAIL: ${f.cmd}\n  exit=${f.exitCode}\n  output: ${f.output.trim().split("\n").slice(-5).join("\n  ")}`
    ).join("\n\n");
  }

  return { allPassed, results, summary, diagnostics, pending };
}

/**
 * Build a concrete diagnostic prompt for Brain to send to the coder.
 * Reads the failed test outputs and produces actionable instructions.
 * @param {object[]} failedResults - Array of failed test results
 * @returns {string} Prompt for the coder with concrete fix instructions
 */
export function buildDiagnosticPrompt(failedResults) {
  if (!failedResults || failedResults.length === 0) return "";
  const lines = ["The following acceptance tests FAILED. Fix each one:", ""];
  for (const f of failedResults) {
    lines.push(`❌ Command: ${f.cmd}`);
    lines.push(`   Exit code: ${f.exitCode}`);
    const lastLines = f.output.trim().split("\n").slice(-8);
    lines.push(`   Last output:`);
    for (const l of lastLines) {
      lines.push(`     ${l}`);
    }
    lines.push("");
  }
  lines.push("Fix ALL failing tests. Run each command yourself to verify before finishing.");
  return lines.join("\n");
}

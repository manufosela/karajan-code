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
async function runSingleTest(cmd, cwd, timeoutMs = 30000) {
  try {
    const result = await runCommand("bash", ["-c", cmd], {
      timeout: timeoutMs,
      cwd
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
 * @param {string[]} tests - Array of shell commands
 * @param {string} cwd - Working directory
 * @returns {Promise<{allPassed: boolean, results: object[], summary: string, diagnostics: string|null}>}
 */
export async function runAcceptanceTests(tests, cwd) {
  if (!tests || tests.length === 0) {
    return { allPassed: false, results: [], summary: "No acceptance tests defined", diagnostics: null };
  }

  const results = [];
  for (const cmd of tests) {
    const result = await runSingleTest(cmd, cwd);
    results.push(result);
  }

  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);
  const allPassed = failed.length === 0;

  const summary = `${passed.length}/${results.length} acceptance tests passed`;

  let diagnostics = null;
  if (!allPassed) {
    diagnostics = failed.map(f =>
      `FAIL: ${f.cmd}\n  exit=${f.exitCode}\n  output: ${f.output.trim().split("\n").slice(-5).join("\n  ")}`
    ).join("\n\n");
  }

  return { allPassed, results, summary, diagnostics };
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

/**
 * Mutation runner + report normalizer. Executes a mutation tool and parses its
 * report (the shared mutation-testing-report-schema, `files[].mutants[]`) into a
 * tool-agnostic result the CLI, reviewer and CI can all consume the same way.
 * `exec` and `readReport` are injectable so the logic is testable without a
 * real mutation tool installed.
 */

import { runCommand } from "../utils/process.js";

// A mutant the test suite detected (killed or forced to time out).
const KILLED = new Set(["Killed", "Timeout"]);
// A real survivor: the mutation went undetected (or no test covered it).
const SURVIVED = new Set(["Survived", "NoCoverage"]);
// Not a real result: equivalent, config-ignored, or uncompilable mutants.
const EXCLUDED = new Set(["Ignored", "CompileError", "RuntimeError"]);

/**
 * Normalize a standard-schema report into `{score, killed, survived, total, excluded}`.
 * `score` is the covered mutation score `killed / (killed + survived) * 100`, or
 * null when there is nothing to mutate. Excluded mutants never count as survivors.
 * @param {{files?: Record<string, {mutants?: Array<object>}>}} report
 */
export function parseStandardReport(report) {
  const files = report?.files ?? {};
  let killed = 0;
  let excluded = 0;
  const survived = [];
  for (const [file, entry] of Object.entries(files)) {
    for (const mutant of entry?.mutants ?? []) {
      const { status } = mutant;
      if (EXCLUDED.has(status)) {
        excluded += 1;
      } else if (KILLED.has(status)) {
        killed += 1;
      } else if (SURVIVED.has(status)) {
        survived.push({
          file,
          line: mutant.location?.start?.line ?? null,
          mutator: mutant.mutatorName ?? null,
          status,
        });
      }
    }
  }
  const total = killed + survived.length;
  const score = total === 0 ? null : Number(((killed / total) * 100).toFixed(2));
  return { score, killed, survived, total, excluded };
}

/**
 * Run a mutation tool and normalize the report it produced.
 * @param {object} params
 * @param {string} params.binary
 * @param {string[]} [params.args]
 * @param {string} [params.cwd]
 * @param {Function} [params.exec] - injectable command runner (default runCommand)
 * @param {() => Promise<object>} [params.readReport] - reads/parses the tool's report file
 */
export async function runMutation({ binary, args = [], cwd, exec = runCommand, readReport }) {
  const run = await exec(binary, args, { cwd }).catch((err) => ({
    exitCode: 1,
    stdout: "",
    stderr: String(err?.message ?? err),
  }));
  let result = null;
  if (readReport) {
    const report = await readReport().catch(() => null);
    if (report) result = parseStandardReport(report);
  }
  return { exitCode: run.exitCode, result, stdout: run.stdout, stderr: run.stderr };
}

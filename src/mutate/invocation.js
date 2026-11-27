/**
 * How each mutation tool is launched and where it leaves its report. Shared by
 * `kj mutate` and the review pre-gate so both run the tool the same way.
 */

import fs from "node:fs/promises";
import path from "node:path";

// Per-tool launch detail: subcommand + JSON report path. Tools without a JSON
// report leave `report` empty → the run surfaces the tool's own output.
const INVOCATION = {
  stryker: { base: ["run"], report: "reports/mutation/mutation.json" },
  mutmut: { base: ["run"], report: "mutmut-report.json" },
  infection: { base: [], report: "infection.json" },
  "go-mutesting": { base: [], report: "" },
  pitest: { base: [], report: "" },
};

// Slack for filesystems with coarse mtime, which can date a fresh file
// slightly before the start of the run.
const MTIME_TOLERANCE_MS = 1000;

// A report older than the run is a leftover of an earlier one: null, so the
// runner reports no result instead of passing it off as this run's.
function makeReadReport(reportFile, startedAt) {
  if (!reportFile) return undefined;
  return async () => {
    const { mtimeMs } = await fs.stat(reportFile);
    if (mtimeMs < startedAt - MTIME_TOLERANCE_MS) return null;
    return JSON.parse(await fs.readFile(reportFile, "utf8"));
  };
}

/**
 * Call it right before launching the tool: readReport only accepts a report
 * written from this moment on.
 * @param {{id: string}} tool - a supported tool from the registry
 * @param {string} projectDir
 * @param {string[]} scopeArgs
 * @returns {{args: string[], readReport: (() => Promise<object|null>) | undefined}}
 */
export function mutationInvocation(tool, projectDir, scopeArgs) {
  const { base, report } = INVOCATION[tool.id] ?? { base: [], report: "" };
  const reportFile = report ? path.join(projectDir, report) : "";
  return { args: [...base, ...scopeArgs], readReport: makeReadReport(reportFile, Date.now()) };
}

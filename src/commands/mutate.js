/**
 * `kj mutate` (KJC-TSK-0587) — diff-scoped mutation testing. Detects language
 * (M-A registry) → changed lines (M-B diff-scope) → runs the tool (M-C runner)
 * only over what you just touched. `--json` + exit code make it a gate. No
 * silent fallback: unsupported language / unreadable report exit non-zero.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { detectProjectStack } from "../utils/stack-detect.js";
import { getMutationTool } from "../mutate/tool-registry.js";
import { getDiffScope } from "../mutate/diff-scope.js";
import { runMutation } from "../mutate/runner.js";

// Per-tool launch detail: subcommand + JSON report path. Tools without a JSON
// report leave `report` empty → the run surfaces the tool's own output.
const INVOCATION = {
  stryker: { base: ["run"], report: "reports/mutation/mutation.json" },
  mutmut: { base: ["run"], report: "mutmut-report.json" },
  infection: { base: [], report: "infection.json" },
  "go-mutesting": { base: [], report: "" },
  pitest: { base: [], report: "" },
};

const DEFAULT_SINCE = "HEAD~1";

function makeReadReport(reportFile) {
  if (!reportFile) return undefined;
  return async () => JSON.parse(await fs.readFile(reportFile, "utf8"));
}

/**
 * `deps` ({detectStack, diffScope, run}) is injectable so tests stay pure.
 * `since` diffs against a git ref (default HEAD~1); `path` bypasses the diff.
 * @returns {Promise<number>} process exit code
 */
export async function mutateCommand({
  projectDir = process.cwd(),
  since,
  path: pathArg,
  json = false,
  maxSurvivors = 0,
  logger = console,
  deps = {},
} = {}) {
  const detectStack = deps.detectStack ?? detectProjectStack;
  const diffScope = deps.diffScope ?? getDiffScope;
  const run = deps.run ?? runMutation;
  const say = (msg) => logger.info?.(msg);

  const { language } = await detectStack(projectDir);
  const tool = getMutationTool(language);
  if (!tool.supported) {
    say(`kj mutate: lenguaje no soportado (${language ?? "desconocido"}) — ${tool.reason}`);
    return 2;
  }

  let scope;
  if (pathArg) {
    const args = tool.scope.flag ? [tool.scope.flag, pathArg] : [pathArg];
    scope = { supported: true, empty: false, args };
  } else {
    scope = await diffScope({ since: since ?? DEFAULT_SINCE, language, projectDir });
  }
  if (scope.empty) {
    say("kj mutate: nada que mutar en el diff.");
    return 0;
  }

  const invocation = INVOCATION[tool.id] ?? { base: [], report: "" };
  const reportFile = invocation.report ? path.join(projectDir, invocation.report) : "";
  const outcome = await run({
    binary: tool.binary,
    args: [...invocation.base, ...scope.args],
    cwd: projectDir,
    readReport: makeReadReport(reportFile),
  });

  if (!outcome.result) {
    say(`kj mutate: la herramienta ${tool.id} no produjo un informe legible.`);
    if (outcome.stderr) say(outcome.stderr.trim());
    return 1;
  }

  const { score, killed, total, survived } = outcome.result;
  if (json) {
    say(JSON.stringify(outcome.result));
  } else {
    say(`kj mutate (${tool.id}): score ${score ?? "n/a"}% — ${killed}/${total} mutantes cazados`);
    for (const s of survived) say(`  ✗ superviviente ${s.file}:${s.line} (${s.mutator ?? s.status})`);
    if (survived.length === 0) say("  ✓ sin supervivientes");
  }
  return survived.length > maxSurvivors ? 1 : 0;
}

/**
 * `kj mutate` (KJC-TSK-0587) — diff-scoped mutation testing. Detects language
 * (M-A registry) → changed lines (M-B diff-scope) → runs the tool (M-C runner)
 * only over what you just touched. `--json` + exit code make it a gate. No
 * silent fallback: unsupported language / unreadable report exit non-zero.
 */

import { detectProjectStack } from "../utils/stack-detect.js";
import { getMutationTool } from "../mutate/tool-registry.js";
import { getDiffScope } from "../mutate/diff-scope.js";
import { runMutation } from "../mutate/runner.js";
import { mutationInvocation } from "../mutate/invocation.js";

const DEFAULT_SINCE = "HEAD~1";

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

  const outcome = await run({
    binary: tool.binary,
    cwd: projectDir,
    ...mutationInvocation(tool, projectDir, scope.args),
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

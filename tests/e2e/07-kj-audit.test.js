/**
 * E2E #07 — `kj audit` runs end-to-end on a real path.
 *
 * Spec: tests/e2e spec ("FASE 1") §7.
 *
 * The non-agentic, LLM-free dimension is `--agent-readiness` (issue
 * #542). It scores a tmp repo for AI-agent readability (llms.txt
 * presence, robots allowlist, page token budgets, heading hierarchy).
 * Pre-fix audits crashed with `TypeError` when the audit target had
 * no package.json or no git remote — the regression we pin here.
 *
 * Asserts:
 *   - exit code 0 even on a tmp repo with a "smelly" code shape and
 *     no package.json / no git remote (hardening regression)
 *   - --json output parses and contains entries that flag findings
 *   - no Node-level crash on missing files
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runKj } from "./helpers/spawn-kj.js";
import { makeTmpProject } from "./helpers/tmp-project.js";

function writeSmellyFiles(projectDir) {
  // A "god function" > 300 LOC, an unused variable, and a missing
  // import. The audit dimensions look at architecture / quality
  // shapes; we just need recognisable smells in code/ files. We
  // intentionally do NOT add llms.txt so the agent-readiness audit
  // has at least one failed check.
  const lines = ["// god-function.js"];
  lines.push("export function godFunction() {");
  for (let i = 0; i < 320; i++) lines.push(`  const v${i} = ${i};`);
  lines.push("  return undefinedSymbol; // missing import — smelly");
  lines.push("}");
  fs.writeFileSync(path.join(projectDir, "god-function.js"), lines.join("\n"));
  fs.writeFileSync(path.join(projectDir, "unused-var.js"),
    "const _x = 1; // unused\nexport default 'hello';\n");
  // No package.json, no git remote, no llms.txt — the spec's hardening
  // case.
}

describe("e2e/07 — kj audit on a smelly tmp repo", () => {
  let proj;
  afterEach(() => {
    try { proj?.cleanup(); } catch { /* */ }
  });

  it("kj audit --agent-readiness --json exits 0 and emits findings", () => {
    proj = makeTmpProject({ prefix: "kj-e2e-07-" });
    writeSmellyFiles(proj.projectDir);

    const r = runKj(
      ["audit", "--agent-readiness", "--json", "--path", proj.projectDir],
      { cwd: proj.projectDir, timeoutMs: 60_000 }
    );

    // No Node-level crash on a repo with no package.json / no remote.
    const all = `${r.stdout}\n${r.stderr}`;
    expect(all).not.toMatch(/TypeError|ReferenceError|Cannot read prop/);

    expect(r.exitCode, `audit stderr: ${r.stderr}`).toBe(0);

    // --json output parses; must have a `checks` (or equivalent
    // findings) array.
    const m = r.stdout.match(/\{[\s\S]+\}/);
    expect(m, `no JSON found in audit stdout:\n${r.stdout}`).not.toBeNull();
    const parsed = JSON.parse(m[0]);
    // The agent-readiness reporter emits {score, possible, earned, checks[]}.
    // Either shape is acceptable as long as at least one finding-style
    // entry is present so a downstream consumer can act on it.
    const hasFindings = Array.isArray(parsed.checks) && parsed.checks.length > 0;
    expect(hasFindings, `expected at least one check; got: ${JSON.stringify(parsed).slice(0, 200)}`).toBe(true);

    // At least one check should be failed (we omitted llms.txt etc.),
    // proving the audit actually flags the regression.
    const failed = parsed.checks.some(c => c.ok === false || (Number.isFinite(c.score) && c.score < c.weight));
    expect(failed, "audit should have flagged at least one missing-readiness item on a bare tmp repo").toBe(true);
  }, 90_000);
});

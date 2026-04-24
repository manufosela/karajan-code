/**
 * Architecture regression guard — bound the number of `await import(…)` sites
 * in `src/`.
 *
 * Pre-v2.7.5 there were 163 dynamic imports across `src/`. The audit
 * (TSK-0340) flagged this as a code-reading hazard: grep/bundle analyzers,
 * dead-code detection, IDE jump-to, and TypeScript's own checker all see
 * a partial module graph because the real dependency is hidden behind
 * `await import(string)` at runtime.
 *
 * TSK-0340 converted the redundant ones (where the same module was also
 * statically imported in the same file) to static. That accounts for the
 * drop to the budget below. The remaining imports are legitimate:
 *
 *   - CYCLE BREAKERS: `config-init.js` ↔ `flow-runner.js`, etc. Static
 *     imports would ship one of the files with `undefined` exports at
 *     module evaluation time.
 *   - HOT-PATH LAZY: e.g. plan-loading, HU sub-pipeline,
 *     brain-coordinator — most runs don't reach them, so deferring the
 *     cost of their transitive graph keeps cold-start snappy.
 *   - FEATURE-FLAG GATED: code behind `if (brainCtx.enabled)` /
 *     `if (config.ci?.enabled)`. No point loading those modules when
 *     the flag is off.
 *
 * The budget is a ratchet — it only decreases. If you add a new dynamic
 * import, either justify it (convert another redundant one first, or
 * bump the budget up only with explicit audit documentation).
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_DIR = path.join(REPO_ROOT, "src");

// Budget set to the post-TSK-0340 count + 0 slack: downsize ratchet.
// If this grows, either find a redundant import to convert to static or
// bump the budget in the same PR with a one-line justification below.
const DYNAMIC_IMPORT_BUDGET = 150;

function listJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(p, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function stripCommentsAndStrings(source) {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return out;
}

const DYNAMIC_IMPORT_RE = /\bawait\s+import\s*\(/g;

function countDynamicImports() {
  let total = 0;
  const perFile = new Map();
  for (const file of listJsFiles(SRC_DIR)) {
    const cleaned = stripCommentsAndStrings(fs.readFileSync(file, "utf8"));
    const matches = cleaned.match(DYNAMIC_IMPORT_RE) || [];
    if (matches.length > 0) {
      perFile.set(path.relative(REPO_ROOT, file), matches.length);
      total += matches.length;
    }
  }
  return { total, perFile };
}

function findRedundantImports() {
  // A dynamic `await import("X")` is redundant when the same file ALSO has
  // a static `from "X"`. The cure is to lift the static import and reuse
  // its binding at the dynamic callsite.
  const redundant = [];
  for (const file of listJsFiles(SRC_DIR)) {
    const text = fs.readFileSync(file, "utf8");
    const dyn = new Set(
      [...text.matchAll(/await\s+import\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    );
    const stat = new Set(
      [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    );
    for (const mod of dyn) {
      if (stat.has(mod)) {
        redundant.push({ file: path.relative(REPO_ROOT, file), mod });
      }
    }
  }
  return redundant;
}

describe("architecture/dynamic-imports — budget + no-redundant rule", () => {
  it(`total dynamic import count is ≤ ${DYNAMIC_IMPORT_BUDGET}`, () => {
    const { total, perFile } = countDynamicImports();
    if (total > DYNAMIC_IMPORT_BUDGET) {
      const worst = [...perFile.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([f, n]) => `  ${n}  ${f}`)
        .join("\n");
      throw new Error(
        `Dynamic imports under src/ grew past the ${DYNAMIC_IMPORT_BUDGET} budget ` +
        `(now ${total}).\n\nTop offenders:\n${worst}\n\n` +
        `Either convert a legitimate one to static (see ` +
        `tests/architecture/dynamic-imports.test.js for when that applies), ` +
        `or bump the budget in the SAME PR with a justification comment.`,
      );
    }
  });

  it("no dynamic import is redundant with a static import of the same module", () => {
    const offenders = findRedundantImports();
    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${o.file}: await import("${o.mod}") — already statically imported`)
        .join("\n");
      throw new Error(
        "Redundant dynamic imports detected — lift the static binding and " +
        "reuse it at the callsite:\n" + msg,
      );
    }
  });
});

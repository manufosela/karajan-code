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
//
// 2026-04-27 (PR-L): bumped 150 → 156. The 6 over-budget imports are
// the per-HU machinery inside the HU sub-pipeline path (prepareHuBranch,
// loadActiveAdrs, createBrainContext, applyPolicies, runAcceptanceTests,
// runTesterStage) — extracted from flow-runner.js to drivers/run-hu-batch.js
// in this same PR. Net dynamic-import count is unchanged from before
// PR-L; the 150 budget was already breached by an earlier PR that
// landed without updating this constant.
//
// 2026-04-28: bumped 156 → 159 after fixing a regex order bug in
// stripCommentsAndStrings (block-then-line eats huge spans when a line
// comment contains the literal `/*` — e.g. `// drivers/*`). Three
// `await import(...)` callsites were hiding behind that swallow and
// never counted; they've always existed in the source. Real headcount
// is 159.
//
// 2026-05-04 (KJC-TSK-0151): bumped 159 → 160 for the new PerfStage
// brain-coordinator lazy import. Same feature-flag-gated pattern used
// by sonar-stage.js — `processRoleOutput` is only needed when
// `brainCtx.enabled`, and pulling its transitive graph during cold
// pipeline starts (where the perf gate is off by default) would be
// wasteful.
//
// 2026-05-18 (KJC-TSK v2.17 audit/circular-deps): bumped 160 → 161 for
// the lazy `await import("madge")` in src/audit/circular-deps.js. madge
// transitively pulls @vue/compiler-sfc which optionally requires ~20
// template engines that are not installed — the dynamic load keeps
// `kj audit` working in npm installs and degrades gracefully in the SEA
// binary (madge is marked external; the import throws there and the
// collector returns available:false).
//
// 2026-05-18 (KJC-TSK v2.18 doctor-external-tool-hints): bumped 161 →
// 162 for the lazy `await import("../utils/stack-detect.js")` inside the
// gated lighthouse check (`src/checks/binaries.js`). Stack detection is
// only needed when the lighthouse check actually runs (i.e. when the
// user has the binary or wants the install hint) — deferring it keeps
// non-frontend doctor runs from paying the cost.
//
// 2026-05-25 (KJC-TSK-0447 v2.29 ONNX embedder): bumped 162 → 164 for two
// dynamic imports inside `src/rag/embedders/onnx.js`: it tries
// `@huggingface/transformers` first, then falls back to legacy
// `@xenova/transformers`, and gracefully errors if neither is installed.
// Both packages are optional peer deps (combined ~500 MB with WASM + ONNX
// runtime) so a static import would force every install to pay that cost
// even for users who never opt into provider: onnx. Static imports are
// not an option here by design.
//
// 2026-05-25 (KJC-TSK-0449 v2.29 cross-encoder rerank): bumped 164 → 166
// for the same pattern inside `src/rag/rerank.js`. Same rationale —
// transformers is an optional peer dep, opt-in `--rerank` flag, must
// gracefully error on missing package.
//
// 2026-06-02 (KJC-TSK-0492 PR3 `kj rag mcp` subcommand): bumped 166 → 167.
// `src/commands/rag-mcp.js` dynamic-imports `bin/kj-rag-mcp.js` at action
// time. Static import is not an option: the binary attaches a
// StdioServerTransport at top level, so a static import would launch the
// MCP server on every `kj` invocation, not only `kj rag mcp`.
//
// 2026-06-20 (KJC-TSK-0574 `kj autorun` command): bumped 167 → 169. The
// autorun action lazy-imports the spec resolver and the autorun chain
// (which pulls in the heavy plan + run pipelines) only when invoked, so a
// plain `kj` startup never loads them.
//
// 2026-07-15 (KJC-TSK-0612 clean `kj update` output): bumped 169 → 170 for
// the lazy `await import("execa")` inside `performSelfUpdate`
// (src/utils/update-check.js). update-check.js is loaded on EVERY startup
// (printUpdateNotice in cli.js), but execa is only needed by the `kj update`
// path — a static import would pull the heavy child-process dep into every
// plain `kj` invocation. Same feature-gated pattern as the entries above.
// 2026-08-21 (KJC-TSK-0767): ratchet 170 → 166. The five `kj policy`
// subcommands each re-imported ../commands/policy.js dynamically; one static
// import serves all of them (the module is light: no agents, no RAG).
const DYNAMIC_IMPORT_BUDGET = 166;

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
  // Order matters — see tests/architecture/session-store-imports.test.js for
  // the false-positive that arises if you strip block comments first: a line
  // comment like `// drivers/*` becomes a (lazy) block-comment opener and
  // eats every line until the next `*\/`.
  let out = source.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
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
    const worst = [...perFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([f, n]) => `  ${n}  ${f}`)
      .join("\n");
    expect(
      total,
      `Dynamic imports under src/ grew past the ${DYNAMIC_IMPORT_BUDGET} budget ` +
      `(now ${total}).\n\nTop offenders:\n${worst}\n\n` +
      `Either convert a legitimate one to static (see ` +
      `tests/architecture/dynamic-imports.test.js for when that applies), ` +
      `or bump the budget in the SAME PR with a justification comment.`,
    ).toBeLessThanOrEqual(DYNAMIC_IMPORT_BUDGET);
  });

  it("no dynamic import is redundant with a static import of the same module", () => {
    const offenders = findRedundantImports();
    const msg = offenders
      .map((o) => `  ${o.file}: await import("${o.mod}") — already statically imported`)
      .join("\n");
    expect(
      offenders,
      "Redundant dynamic imports detected — lift the static binding and " +
      "reuse it at the callsite:\n" + msg,
    ).toEqual([]);
  });
});

// Circular import-deps collector for `kj audit` (KJC-TSK — v2.17).
//
// Deterministic, stack-aware. Uses madge programmatically; activates only
// when the project's stack has JS/TS sources. Anything else returns
// { available: false, reason }.
//
// Same best-effort shape as sonar-findings / osv-findings / semgrep-findings:
//   - missing dep or timeout returns { available: false, reason }
//   - findings are passed through audit/issue-filter.js so the user can
//     suppress known cycles via config.audit.false_positives or inline
//     `// karajan-audit-ignore: madge:circular-import` markers.

import path from "node:path";
import fs from "node:fs/promises";
import { filterFalsePositives } from "./issue-filter.js";

// madge is loaded dynamically: in the SEA standalone binary it is excluded
// from the bundle (see scripts/esbuild-sea.config.mjs) and a require()
// failure here cleanly degrades to available:false, while npm installs work
// normally. Keeping the import inside collectCircularDeps() also avoids
// paying the load cost for non-JS projects.

const SCAN_TIMEOUT_MS = 60_000;
const MAX_CYCLES_REPORTED = 50;

// Extensions madge will follow. Python/Go/etc. are not supported and we
// short-circuit on stack detection — listing only JS/TS variants here is a
// safety net so we never accidentally scan unrelated files.
const JS_TS_EXTENSIONS = ["js", "mjs", "cjs", "jsx", "ts", "tsx"];

function hasJsTsStack(stack) {
  if (!stack) return false;
  const lang = (stack.language || "").toLowerCase();
  if (lang === "javascript" || lang === "typescript") return true;
  const langs = Array.isArray(stack.languages) ? stack.languages : [];
  return langs.some((l) => /^(javascript|typescript|jsx?|tsx?)$/i.test(String(l)));
}

async function findTsConfig(projectDir) {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const p = path.join(projectDir, name);
    try { await fs.access(p); return p; } catch { /* not present */ }
  }
  return undefined;
}

function pickEntrypoint(projectDir) {
  // madge needs an entrypoint. We prefer common conventions; if none
  // exists we fall back to scanning `src/` which covers ~95% of JS/TS
  // projects we've seen.
  return path.join(projectDir, "src");
}

/**
 * Collect circular-import findings for a project.
 *
 * @param {string} projectDir
 * @param {object} stack - shape returned by detectProjectStack()
 * @param {object} [config] - kj config (for config.audit.false_positives)
 * @param {object} [logger]
 * @returns {Promise<{available: boolean, reason?: string, total?: number, cycles?: object[], suppressed?: object[]}>}
 */
export async function collectCircularDeps(projectDir, stack, config = {}, logger = null) {
  if (!hasJsTsStack(stack)) {
    return { available: false, reason: "no JS/TS sources detected — circular-dep scan skipped" };
  }

  const entry = pickEntrypoint(projectDir);
  try { await fs.access(entry); } catch {
    return { available: false, reason: `entrypoint ${path.relative(projectDir, entry)} not found` };
  }

  let madge;
  try {
    ({ default: madge } = await import("madge"));
  } catch (err) {
    return { available: false, reason: `madge not loadable (${err?.message || err}). In the SEA binary install karajan-code via npm to enable.` };
  }

  const tsConfig = await findTsConfig(projectDir);
  const opts = {
    fileExtensions: JS_TS_EXTENSIONS,
    excludeRegExp: [/node_modules/, /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /dist\//, /build\//, /coverage\//],
    detectiveOptions: { es6: { mixedImports: true } },
  };
  if (tsConfig) opts.tsConfig = tsConfig;

  let cycles;
  try {
    const scan = await Promise.race([
      madge(entry, opts),
      new Promise((_, rej) => setTimeout(() => rej(new Error("madge timeout")), SCAN_TIMEOUT_MS)),
    ]);
    cycles = scan.circular() || [];
  } catch (err) {
    logger?.warn?.(`audit/circular-deps: madge failed (${err?.message || err})`);
    return { available: false, reason: `madge run failed: ${err?.message || err}` };
  }

  // madge returns paths relative to the entry dir; normalize to paths
  // relative to projectDir so they match how the rest of the audit (Sonar,
  // Semgrep) reports locations and so config.audit.false_positives can
  // target them with familiar globs like "src/".
  const relPrefix = path.relative(projectDir, entry);
  const normalizedCycles = cycles.map((cycle) =>
    cycle.map((p) => (relPrefix ? path.join(relPrefix, p) : p)),
  );

  const issues = normalizedCycles.slice(0, MAX_CYCLES_REPORTED).map((cycle, idx) => ({
    tool: "madge",
    rule: "circular-import",
    component: cycle[0],
    path: cycle[0],
    line: 1,
    severity: cycle.length >= 4 ? "MAJOR" : "MINOR",
    message: `Circular import chain (${cycle.length} files): ${cycle.join(" → ")} → ${cycle[0]}`,
    cycle,
    index: idx,
  }));

  const extraRules = (config?.audit?.false_positives || []).filter((r) => r.tool === "madge");
  const { kept, suppressed } = filterFalsePositives(issues, { extraRules, projectRoot: projectDir });

  return {
    available: true,
    total: kept.length,
    suppressedCount: suppressed.length,
    cycles: kept,
    suppressed,
    truncated: normalizedCycles.length > MAX_CYCLES_REPORTED ? normalizedCycles.length - MAX_CYCLES_REPORTED : 0,
  };
}

/**
 * Group cycles by severity for the deterministic summary renderer.
 */
export function groupCyclesBySeverity(cycles) {
  const groups = { MAJOR: [], MINOR: [] };
  for (const c of cycles || []) {
    const sev = c.severity || "MINOR";
    if (groups[sev]) groups[sev].push(c);
  }
  return groups;
}

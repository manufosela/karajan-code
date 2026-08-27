// Dead exports collector for `kj audit` (KJC-TSK v2.17, code-quality dim).
//
// Wraps knip via subprocess. Reports unused exports + unused files —
// findings consumed deterministically by the LLM phase so the coder
// stops shipping new code without noticing dead code piling up.
//
// Same best-effort pattern as madge / semgrep / osv / sonar:
//   - missing project signal (no package.json, no JS/TS) → available:false
//   - missing knip binary → available:false (degrades cleanly in SEA)
//   - timeout / parse error → available:false with reason
//
// Findings pass through audit/issue-filter.js so users can suppress
// false positives via config.audit.false_positives (tool="knip") or
// inline `// karajan-audit-ignore: knip:<ruleId>`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { filterFalsePositives } from "./issue-filter.js";

const execFileAsync = promisify(execFile);

const SCAN_TIMEOUT_MS = 120_000;
const MAX_DEAD_EXPORTS_REPORTED = 100;
const MAX_UNUSED_FILES_REPORTED = 50;

// KJC-TSK-0794 AC7: a Firebase callable or a declared global-setup reported as
// dead is the false positive that gets the inventory switched off. When the
// project declares nothing itself, kj declares FOR it what it can read.
const KNIP_OWN_CONFIGS = ["knip.json", "knip.jsonc", ".knip.json", "knip.js", "knip.ts", "knip.config.js", "knip.config.ts"];
// knip's default root entry patterns, restated because an explicit `entry`
// REPLACES them (package.json main/bin/exports always count on their own).
const KNIP_DEFAULT_ENTRY = ["{index,cli,main}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}", "src/{index,cli,main}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"];

async function hasOwnKnipConfig(projectDir) {
  for (const f of KNIP_OWN_CONFIGS) {
    try { await fs.access(path.join(projectDir, f)); return true; } catch { /* keep looking */ }
  }
  try { return Boolean(JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8")).knip); } catch { return false; }
}

/** Entrypoints kj can vouch for: config.audit.entrypoints (the user's word) and
 * firebase.json's functions.source (the platform's word). Null when nothing. */
async function resolveProjectEntrypoints(projectDir, config) {
  const declared = (config?.audit?.entrypoints || []).filter((e) => typeof e === "string");
  const firebase = [];
  try {
    const fb = JSON.parse(await fs.readFile(path.join(projectDir, "firebase.json"), "utf8"));
    const fns = Array.isArray(fb.functions) ? fb.functions : fb.functions ? [fb.functions] : [];
    for (const f of fns) if (typeof f?.source === "string") firebase.push(f.source);
  } catch { /* no firebase.json — nothing to declare */ }
  return declared.length || firebase.length ? { declared, firebase } : null;
}

function buildEphemeralKnipConfig({ declared, firebase }) {
  const root = { entry: [...KNIP_DEFAULT_ENTRY, ...declared] };
  if (!firebase.length) return root;
  const workspaces = { ".": root };
  for (const src of firebase) workspaces[src] = { entry: ["index.{js,ts}", "src/index.{js,ts}"] };
  return { workspaces };
}

function hasJsTsStack(stack) {
  if (!stack) return false;
  const lang = (stack.language || "").toLowerCase();
  if (lang === "javascript" || lang === "typescript") return true;
  const langs = Array.isArray(stack.languages) ? stack.languages : [];
  return langs.some((l) => /^(javascript|typescript|jsx?|tsx?)$/i.test(String(l)));
}

async function hasPackageJson(projectDir) {
  try { await fs.access(path.join(projectDir, "package.json")); return true; } catch { return false; }
}

/**
 * Resolve the knip binary path relative to this package's node_modules.
 * In SEA builds knip is `external` and require.resolve throws — we let
 * the caller catch it and return available:false.
 *
 * knip restricts its subpath exports to "." and "./session", so we can't
 * directly resolve "knip/bin/knip.js" or even "knip/package.json".
 * Instead we resolve "knip" (the main entry, dist/index.js), walk up to
 * its package root, and locate bin/knip.js from there.
 */
function resolveKnipBin() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("knip"); // e.g. .../node_modules/knip/dist/index.js
  // entry is .../node_modules/knip/dist/index.js — the package root is two levels up
  const knipRoot = path.dirname(path.dirname(entry));
  return path.join(knipRoot, "bin", "knip.js");
}

/**
 * Collect dead-exports findings for a project.
 *
 * @param {string} projectDir
 * @param {object} stack
 * @param {object} [config]
 * @param {object} [logger]
 * @returns {Promise<{available: boolean, reason?: string, total?: number, exports?: object[], files?: object[], suppressed?: object[]}>}
 */
export async function collectDeadExports(projectDir, stack, config = {}, logger = null) {
  if (!hasJsTsStack(stack)) {
    return { available: false, reason: "no JS/TS sources detected — dead-export scan skipped" };
  }
  if (!(await hasPackageJson(projectDir))) {
    return { available: false, reason: "no package.json found — knip needs one to detect entry points" };
  }

  let knipBin;
  try { knipBin = resolveKnipBin(); } catch (err) {
    return { available: false, reason: `knip binary not resolvable (${err?.message || err}). In the SEA binary install karajan-code via npm to enable.` };
  }

  const args = [knipBin, "--reporter", "json", "--no-progress", "--no-exit-code"];
  let declaredEntrypoints = null;
  try {
    const eps = await resolveProjectEntrypoints(projectDir, config);
    // a project with its OWN knip config already decided — it is respected
    if (eps && !(await hasOwnKnipConfig(projectDir))) {
      const cfgPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "kj-knip-")), "knip.json");
      await fs.writeFile(cfgPath, JSON.stringify(buildEphemeralKnipConfig(eps)));
      args.push("--config", cfgPath);
      declaredEntrypoints = eps;
    }
  } catch { /* declaring is best-effort; the default scan still runs */ }

  let raw;
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      args,
      { cwd: projectDir, timeout: SCAN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    raw = stdout;
  } catch (err) {
    // knip exits non-zero when issues are found; with --no-exit-code that
    // should not happen, but old configs might still trigger it. If the
    // process produced JSON on stdout we still try to parse it.
    raw = err?.stdout || "";
    if (!raw) {
      logger?.warn?.(`audit/dead-exports: knip failed (${err?.message || err})`);
      return { available: false, reason: `knip run failed: ${err?.shortMessage || err?.message || err}` };
    }
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    return { available: false, reason: `knip output not parseable as JSON (${err?.message || err})` };
  }

  // knip --reporter json shape: { files: [paths], issues: [{ file, exports?, types?, ... }], ... }
  const unusedFiles = Array.isArray(report.files) ? report.files : [];
  const fileIssues = Array.isArray(report.issues) ? report.issues : [];

  const deadExportIssues = [];
  for (const fi of fileIssues) {
    const file = fi.file || fi.filePath || "";
    if (!file) continue;
    for (const ex of fi.exports || []) {
      deadExportIssues.push({
        tool: "knip",
        rule: "unused-exports",
        component: file,
        path: file,
        line: ex.line || 1,
        col: ex.col,
        name: ex.name,
        severity: "MINOR",
        message: `Unused export \`${ex.name}\` in ${file}`,
      });
    }
    for (const t of fi.types || []) {
      deadExportIssues.push({
        tool: "knip",
        rule: "unused-types",
        component: file,
        path: file,
        line: t.line || 1,
        name: t.name,
        severity: "MINOR",
        message: `Unused type \`${t.name}\` in ${file}`,
      });
    }
  }

  const unusedFileIssues = unusedFiles.map((f) => ({
    tool: "knip",
    rule: "unused-files",
    component: f,
    path: f,
    line: 1,
    severity: "MAJOR",
    message: `Unused file: ${f}`,
  }));

  const allIssues = [
    ...deadExportIssues.slice(0, MAX_DEAD_EXPORTS_REPORTED),
    ...unusedFileIssues.slice(0, MAX_UNUSED_FILES_REPORTED),
  ];
  const extraRules = (config?.audit?.false_positives || []).filter((r) => r.tool === "knip");
  const { kept, suppressed } = filterFalsePositives(allIssues, { extraRules, projectRoot: projectDir });

  const keptExports = kept.filter((i) => i.rule === "unused-exports" || i.rule === "unused-types");
  const keptFiles = kept.filter((i) => i.rule === "unused-files");

  return {
    available: true,
    total: kept.length,
    suppressedCount: suppressed.length,
    declaredEntrypoints,
    exports: keptExports,
    files: keptFiles,
    suppressed,
    truncated: {
      exports: deadExportIssues.length > MAX_DEAD_EXPORTS_REPORTED ? deadExportIssues.length - MAX_DEAD_EXPORTS_REPORTED : 0,
      files: unusedFiles.length > MAX_UNUSED_FILES_REPORTED ? unusedFiles.length - MAX_UNUSED_FILES_REPORTED : 0,
    },
  };
}

/**
 * Group dead-export issues by severity for the deterministic summary.
 */
export function groupDeadExportsBySeverity(items) {
  const groups = { MAJOR: [], MINOR: [] };
  for (const i of items || []) {
    const sev = i.severity || "MINOR";
    if (groups[sev]) groups[sev].push(i);
  }
  return groups;
}

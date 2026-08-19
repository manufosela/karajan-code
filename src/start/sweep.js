// KJC-TSK-0568 (Onboard A) — read-only sweep orchestrator for the Brain.
//
// Runs the READ-ONLY signals fitting the project's maturity and aggregates them
// into one structured bundle for synthesis (Onboard B, 0569). Writes nothing.
// No LLM: maturity is deterministic and the costly audit is deferred — legacy
// only flags `deepHealthRecommended` (0570 decides). Subset by maturity: new =
// brief+tests; existing/legacy = + drift, harden advisory, rag + qmd status.
// Collaborators are injected (opts.deps) so it stays trivially testable.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

import { collectAll } from "../onboarder/collectors/index.js";
import { checkHarden } from "../harden/check.js";
import { compareHarden } from "../harden/advisory.js";
import { detectTestFramework } from "../utils/project-detect.js";
import { detectQmd } from "../utils/qmd-detect.js";
import {
  dbPath, openVecStore, projectSlug, countChunks, getLastIndexedCommit,
} from "../rag/vec-store.js";
import { classifyMaturity } from "./maturity.js";

const CODE_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go",
  ".rs", ".java", ".php", ".rb", ".c", ".cc", ".cpp", ".cs",
]);
// KJC-BUG-0141 — infra projects (k8s/terraform/shell/Docker) ARE source code,
// and code nested deeper than the display tree's maxDepth must still count.
const INFRA_EXT = new Set([".yaml", ".yml", ".tf", ".hcl", ".sh"]);
const INFRA_NAMES = new Set(["Dockerfile", "Makefile", "Vagrantfile"]);
const SCAN_IGNORED = new Set([
  "node_modules", "dist", "build", "out", "vendor", "coverage", "target", "__pycache__",
]);
const SCAN_MAX_DEPTH = 6;
const SCAFFOLD_MAX_FILES = 3;
const CI_MARKERS = [".github/workflows", ".gitlab-ci.yml"];

const safe = async (fn) => { try { return await fn(); } catch { return null; } };

const isTestPath = (p) => {
  const posix = p.replaceAll("\\", "/");
  return /\.(test|spec)\./.test(posix) || /(^|\/)(test|tests|__tests__)\//.test(posix);
};

/**
 * Deep source counter with its own walk: the display tree stops at depth 2,
 * which made backend/app/… projects look empty (KJC-BUG-0141).
 * @returns {Promise<{code: number, infra: number}>}
 */
export async function deepSourceScan(projectDir, { maxDepth = SCAN_MAX_DEPTH } = {}) {
  const counts = { code: 0, infra: 0 };
  const walk = async (dir, depth) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".") || SCAN_IGNORED.has(ent.name)) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1);
        continue;
      }
      if (!ent.isFile() || isTestPath(relative(projectDir, full))) continue;
      const ext = ent.name.slice(ent.name.lastIndexOf("."));
      if (CODE_EXT.has(ext)) counts.code += 1;
      else if (INFRA_EXT.has(ext) || INFRA_NAMES.has(ent.name)) counts.infra += 1;
    }
  };
  await walk(projectDir, 0);
  return counts;
}

/** Count real source files in a tree bundle, skipping tests. */
export function countCodeFiles(tree = []) {
  let n = 0;
  for (const node of tree) {
    if (node.kind === "dir") n += countCodeFiles(node.children);
    else if (node.kind === "file") {
      const ext = node.path.slice(node.path.lastIndexOf("."));
      if (CODE_EXT.has(ext) && !isTestPath(node.path)) n += 1;
    }
  }
  return n;
}

/** Age of the last commit in days, or null on non-git / no commits. */
function lastCommitAgeDays(projectDir) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct"], {
      cwd: projectDir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!out) return null;
    return Math.floor((Date.now() - Number(out) * 1000) / 86_400_000);
  } catch { return null; }
}

/** Read-only RAG index status; null when no index file exists yet. */
function readRagStatus(projectDir) {
  try {
    if (!existsSync(dbPath())) return { indexed: false, chunks: 0, lastIndexedCommit: null };
    const db = openVecStore();
    return {
      indexed: true,
      chunks: countChunks(db, { kind: "code" }),
      lastIndexedCommit: getLastIndexedCommit(db, projectSlug(projectDir)),
    };
  } catch { return null; }
}

/**
 * @param {string} projectDir
 * @param {{declared?: ("new"|"existing"|"legacy"|null), profile?: string, deps?: object}} [opts]
 *   declared = user-declared maturity; deps = injected collaborators (defaults = real collectors).
 */
export async function runReadOnlySweep(projectDir, { declared = null, profile = "standard", deps = {} } = {}) {
  const d = {
    collectAll, detectTestFramework, checkHarden, compareHarden, sourceScan: deepSourceScan,
    detectQmd, ragStatus: readRagStatus, gitAgeDays: lastCommitAgeDays, ...deps,
  };

  const brief = await safe(() => d.collectAll(projectDir));
  const tests = await safe(() => d.detectTestFramework(projectDir));
  const scan = await safe(() => d.sourceScan(projectDir));

  const tree = brief?.tree ?? [];
  const present = brief?.configs?.present ?? [];
  const codeFiles = scan ? scan.code + scan.infra : countCodeFiles(tree);
  const commitCount = brief?.git?.commitCount ?? 0;

  const signals = {
    hasSourceCode: codeFiles > 0,
    infraFiles: scan?.infra ?? 0,
    scaffoldingOnly: codeFiles > 0 && codeFiles <= SCAFFOLD_MAX_FILES && commitCount <= 1,
    hasTests: Boolean(tests?.hasTests),
    hasCI: CI_MARKERS.some((m) => present.includes(m)),
    commitCount,
    staleDays: d.gitAgeDays(projectDir),
  };

  const maturity = classifyMaturity({ declared, ...signals });
  const deep = maturity.maturity !== "new";

  return {
    projectDir,
    maturity,
    signals,
    brief,
    tests,
    drift: deep ? await safe(() => d.checkHarden({ projectDir, profile })) : null,
    improvements: deep ? await safe(() => d.compareHarden({ projectDir, profile })) : null,
    rag: deep ? await safe(() => d.ragStatus(projectDir)) : null,
    qmd: deep ? await safe(() => d.detectQmd()) : null,
    collectedAt: new Date().toISOString(),
  };
}

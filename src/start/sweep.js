// KJC-TSK-0568 (Onboard A) — read-only sweep orchestrator for the Brain.
//
// Runs the READ-ONLY signals fitting the project's maturity and aggregates them
// into one structured bundle for synthesis (Onboard B, 0569). Writes nothing.
// No LLM: maturity is deterministic and the costly audit is deferred — legacy
// only flags `deepHealthRecommended` (0570 decides). Subset by maturity: new =
// brief+tests; existing/legacy = + drift, harden advisory, rag + qmd status.
// Collaborators are injected (opts.deps) so it stays trivially testable.
import { existsSync } from "node:fs";
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
const SCAFFOLD_MAX_FILES = 3;
const CI_MARKERS = [".github/workflows", ".gitlab-ci.yml"];

const safe = async (fn) => { try { return await fn(); } catch { return null; } };

/** Count real source files in a tree bundle, skipping tests. */
export function countCodeFiles(tree = []) {
  let n = 0;
  for (const node of tree) {
    if (node.kind === "dir") n += countCodeFiles(node.children);
    else if (node.kind === "file") {
      const ext = node.path.slice(node.path.lastIndexOf("."));
      const isTest = /\.(test|spec)\./.test(node.path) || /(^|\/)(test|tests|__tests__)\//.test(node.path);
      if (CODE_EXT.has(ext) && !isTest) n += 1;
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
    collectAll, detectTestFramework, checkHarden, compareHarden,
    detectQmd, ragStatus: readRagStatus, gitAgeDays: lastCommitAgeDays, ...deps,
  };

  const brief = await safe(() => d.collectAll(projectDir));
  const tests = await safe(() => d.detectTestFramework(projectDir));

  const tree = brief?.tree ?? [];
  const present = brief?.configs?.present ?? [];
  const codeFiles = countCodeFiles(tree);
  const commitCount = brief?.git?.commitCount ?? 0;

  const signals = {
    hasSourceCode: codeFiles > 0,
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

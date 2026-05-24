// Onboarder collectors — deterministic, zero-LLM extractors. Each pure,
// JSON-serialisable, fail-soft (returns null on the slot, never throws).
// Output bundle is consumed by PR 2 synthesis or dumped via `--no-synth`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { detectProjectStack } from "../../utils/stack-detect.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".karajan", ".next", "__pycache__"]);

function safeRun(cmd, args, opts = {}) {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim(); }
  catch { return null; }
}

// Tree summary: immediate dirs with rough byte count. Ignores noise dirs.
export async function collectTree(projectDir, { maxDepth = 2 } = {}) {
  async function walk(dir, depth) {
    if (depth > maxDepth) return [];
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
    const out = [];
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.name !== ".github") continue;
      if (IGNORED_DIRS.has(ent.name)) continue;
      const sub = join(dir, ent.name);
      if (ent.isDirectory()) {
        const children = await walk(sub, depth + 1);
        let bytes = 0;
        for (const c of children) bytes += c.bytes || 0;
        out.push({ path: relative(projectDir, sub), kind: "dir", bytes, children });
      } else if (ent.isFile()) {
        try { out.push({ path: relative(projectDir, sub), kind: "file", bytes: statSync(sub).size }); } catch { /* race */ }
      }
    }
    return out;
  }
  return walk(projectDir, 0);
}

// Git log + branches + hot files. Returns null on non-git (greenfield).
export function collectGitHistory(projectDir, { maxHotFiles = 10 } = {}) {
  const inside = safeRun("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectDir });
  if (inside !== "true") return null;
  const commitsRaw = safeRun("git", ["log", "--oneline", "-n", "100"], { cwd: projectDir }) || "";
  const branchesRaw = safeRun("git", ["branch", "--list", "--all", "--format=%(refname:short)"], { cwd: projectDir }) || "";
  const hotRaw = safeRun("git", ["log", "--name-only", "--pretty=format:", "-n", "200"], { cwd: projectDir }) || "";
  const counts = {};
  for (const line of hotRaw.split("\n").map((s) => s.trim()).filter(Boolean)) {
    counts[line] = (counts[line] || 0) + 1;
  }
  const hotFiles = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]).slice(0, maxHotFiles)
    .map(([file, touches]) => ({ file, touches }));
  return {
    commitCount: commitsRaw ? commitsRaw.split("\n").length : 0,
    branches: branchesRaw.split("\n").filter(Boolean),
    hotFiles,
    headSha: safeRun("git", ["rev-parse", "HEAD"], { cwd: projectDir }) || null,
  };
}

// Presence-check of known config files + package.json scripts.
export function collectConfigs(projectDir) {
  const configFiles = [
    "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
    "tsconfig.json", "jsconfig.json",
    ".eslintrc.js", ".eslintrc.json", "eslint.config.js",
    "vitest.config.js", "vitest.config.ts", "jest.config.js", "jest.config.ts",
    "firebase.json", ".gcloudignore", "Dockerfile", "docker-compose.yml",
    ".github/workflows", ".gitlab-ci.yml", "Makefile",
  ];
  const present = configFiles.filter((f) => existsSync(join(projectDir, f)));
  let scripts = null;
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    scripts = pkg.scripts || null;
  } catch { /* not a node project */ }
  return { present, scripts };
}

// Discover ADR files under docs/adr/, docs/adrs/, docs/architecture/, root.
export async function collectAdrs(projectDir) {
  const dirs = ["docs/adr", "docs/adrs", "docs/architecture", "."];
  const found = [];
  for (const d of dirs) {
    const abs = join(projectDir, d);
    if (!existsSync(abs)) continue;
    try {
      const entries = await readdir(abs);
      for (const f of entries) {
        if (/^adr-?\d|^\d{4}-.+\.md$/i.test(f) || /architecture.*\.md$/i.test(f)) {
          found.push(relative(projectDir, join(abs, f)));
        }
      }
    } catch { /* unreadable */ }
  }
  return found;
}

// One-shot bundle: every slot is independent; missing slots → null/[].
export async function collectAll(projectDir) {
  const [stack, tree, adrs] = await Promise.all([
    detectProjectStack(projectDir).catch(() => null),
    collectTree(projectDir).catch(() => []),
    collectAdrs(projectDir).catch(() => []),
  ]);
  return {
    projectDir,
    stack,
    tree,
    git: collectGitHistory(projectDir),
    configs: collectConfigs(projectDir),
    adrs,
    collectedAt: new Date().toISOString(),
  };
}

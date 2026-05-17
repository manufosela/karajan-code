/**
 * addyosmani/agent-skills catalog provider (KJC-TSK-0327).
 *
 * Fetches and caches the addyosmani/agent-skills repository (20+ process
 * skills: TDD, code-review, security, performance, git-workflow, debugging,
 * CI/CD, docs, spec-driven, planning...) and exposes them as a first-class
 * skill source for Karajan's pipeline.
 *
 * This catalog is ORTHOGONAL to the OpenSkills marketplace (which hosts stack
 * skills like astro, react, prisma, python-data). Together they cover:
 *   - addyosmani    → lifecycle/process skills mapped per role
 *   - OpenSkills    → stack/framework skills detected from task + deps
 *   - local skills  → project-specific skills under .claude/skills
 *
 * Lifecycle:
 *   1. ensureCatalog()      – clone (depth=1) on first use
 *   2. refreshIfStale()     – git pull when older than TTL (default 7d)
 *   3. loadSkillBySlug()    – read /skills/<slug>/SKILL.md from disk
 *   4. listAvailableSlugs() – enumerate the /skills/ directory
 *
 * Degradation contract: when git is missing, the network is unreachable, or
 * the catalog directory is malformed, every exported function returns safe
 * empty values and logs a warning. The pipeline NEVER blocks on this module.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/process.js";
import { getKarajanHome } from "../utils/paths.js";

const REPO_URL = "https://github.com/addyosmani/agent-skills.git";
const CATALOG_DIR_NAME = "agent-skills";
const SKILLS_SUBDIR = "skills";
const SKILL_FILE = "SKILL.md";
const DEFAULT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const META_FILENAME = ".karajan-catalog-meta.json";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Absolute path to the cached catalog inside ~/.karajan/.
 * @returns {string}
 */
export function getCatalogRoot() {
  return path.join(getKarajanHome(), CATALOG_DIR_NAME);
}

function getSkillsRoot() {
  return path.join(getCatalogRoot(), SKILLS_SUBDIR);
}

function getMetaPath() {
  return path.join(getCatalogRoot(), META_FILENAME);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readMeta() {
  try {
    const raw = await fs.readFile(getMetaPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeMeta(meta) {
  await fs.mkdir(getCatalogRoot(), { recursive: true });
  await fs.writeFile(getMetaPath(), JSON.stringify(meta, null, 2), "utf8");
}

/**
 * Check whether `git` is on PATH. Cached per-process.
 * @returns {Promise<boolean>}
 */
let _gitAvailable = null;
export async function isGitAvailable() {
  if (_gitAvailable !== null) return _gitAvailable;
  try {
    const result = await runCommand("git", ["--version"], { timeout: 5_000 });
    _gitAvailable = result.exitCode === 0;
  } catch {
    _gitAvailable = false;
  }
  return _gitAvailable;
}

// Internal: reset the cached probe (tests use this to re-evaluate git presence).
export function __resetGitProbe() {
  _gitAvailable = null;
}

/**
 * Clone the addyosmani/agent-skills repo (shallow) if it does not already
 * exist locally. No-op when it is already present.
 *
 * @param {{ repoUrl?: string, logger?: object }} [opts]
 * @returns {Promise<{ok: boolean, path?: string, error?: string, skipped?: boolean}>}
 */
export async function ensureCatalog(opts = {}) {
  const { repoUrl = REPO_URL, logger } = opts;
  const root = getCatalogRoot();

  if (await pathExists(path.join(root, ".git"))) {
    return { ok: true, path: root, skipped: true };
  }

  if (!(await isGitAvailable())) {
    logger?.warn?.("addyosmani-catalog: git not available — skipping catalog bootstrap");
    return { ok: false, error: "git not available" };
  }

  await fs.mkdir(path.dirname(root), { recursive: true });

  const result = await runCommand(
    "git",
    ["clone", "--depth", "1", repoUrl, root],
    { timeout: 120_000 }
  );

  if (result.exitCode !== 0) {
    const stderr = (result.stderr || "").trim();
    logger?.warn?.(`addyosmani-catalog: clone failed — ${stderr}`);
    return { ok: false, error: stderr || `clone failed (exit ${result.exitCode})` };
  }

  await writeMeta({
    repoUrl,
    clonedAt: new Date().toISOString(),
    lastPullAt: new Date().toISOString(),
  });

  return { ok: true, path: root };
}

/**
 * Refresh the catalog via `git pull` when the cached copy is older than
 * `refreshMs`. When the catalog does not exist yet, delegates to
 * ensureCatalog().
 *
 * @param {{ refreshMs?: number, repoUrl?: string, force?: boolean, logger?: object }} [opts]
 * @returns {Promise<{ok: boolean, action: "cloned"|"pulled"|"reset"|"fresh"|"skipped", error?: string}>}
 */
export async function refreshIfStale(opts = {}) {
  const { refreshMs = DEFAULT_REFRESH_MS, repoUrl = REPO_URL, force = false, logger } = opts;
  const root = getCatalogRoot();

  if (!(await pathExists(path.join(root, ".git")))) {
    const cloneResult = await ensureCatalog({ repoUrl, logger });
    return cloneResult.ok
      ? { ok: true, action: "cloned" }
      : { ok: false, action: "skipped", error: cloneResult.error };
  }

  const meta = await readMeta();
  const lastPull = meta?.lastPullAt ? Date.parse(meta.lastPullAt) : 0;
  const age = Date.now() - (Number.isFinite(lastPull) ? lastPull : 0);
  if (!force && age < refreshMs) {
    return { ok: true, action: "fresh" };
  }

  if (!(await isGitAvailable())) {
    logger?.warn?.("addyosmani-catalog: git unavailable — using stale cache");
    return { ok: true, action: "skipped" };
  }

  const pullResult = await runCommand(
    "git",
    ["-C", root, "pull", "--ff-only", "--depth", "1"],
    { timeout: 60_000 }
  );

  let action = "pulled";
  if (pullResult.exitCode !== 0) {
    // The cached catalog is read-only (we never commit to it), so a
    // non-fast-forward result is virtually always upstream rewriting
    // history with `git push --force` — see KJC-BUG-0033 / N3-2 (the
    // user hit this on 2026-05-07 when addyosmani force-pushed his
    // skills repo). Recover by fetching shallow and hard-resetting to
    // FETCH_HEAD: there's nothing local to lose.
    const fetchResult = await runCommand(
      "git",
      ["-C", root, "fetch", "--depth", "1", "origin", "HEAD"],
      { timeout: 60_000 }
    );
    const resetResult = fetchResult.exitCode === 0
      ? await runCommand("git", ["-C", root, "reset", "--hard", "FETCH_HEAD"], { timeout: 30_000 })
      : { exitCode: fetchResult.exitCode, stderr: fetchResult.stderr };

    if (resetResult.exitCode !== 0) {
      const pullErr = (pullResult.stderr || "").trim();
      const recoveryErr = (resetResult.stderr || "").trim();
      const combined = recoveryErr ? `${pullErr} | recovery: ${recoveryErr}` : pullErr;
      logger?.warn?.(`addyosmani-catalog: git pull failed — ${combined} (keeping stale cache)`);
      return { ok: false, action: "skipped", error: combined };
    }
    action = "reset";
    logger?.info?.("addyosmani-catalog: ff-only failed, recovered via fetch+reset (upstream force-pushed)");
  }

  await writeMeta({
    ...(meta || {}),
    repoUrl,
    lastPullAt: new Date().toISOString(),
  });

  return { ok: true, action };
}

/**
 * Parse YAML frontmatter for name + description (we intentionally avoid a
 * YAML dep — a tiny regex is enough for the fields we care about and stays
 * compatible with addyosmani's SKILL.md format).
 *
 * @param {string} raw
 * @returns {{name: string|null, description: string|null, body: string}}
 */
export function parseFrontmatter(raw) {
  if (!raw) return { name: null, description: null, body: "" };
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { name: null, description: null, body: raw };
  }
  const frontmatter = match[1];
  const body = match[2] || "";

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch ? stripQuotes(nameMatch[1]) : null,
    description: descMatch ? stripQuotes(descMatch[1]) : null,
    body,
  };
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Enumerate available skill slugs under /skills/.
 *
 * @returns {Promise<string[]>}
 */
export async function listAvailableSlugs() {
  const root = getSkillsRoot();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith("."))
    .sort();
}

/**
 * Load a skill by its slug. Returns null when the slug is not present or the
 * SKILL.md file is missing/unreadable.
 *
 * @param {string} slug
 * @returns {Promise<{slug: string, name: string, description: string|null, content: string, path: string}|null>}
 */
export async function loadSkillBySlug(slug) {
  if (!slug || typeof slug !== "string") return null;
  const safeSlug = slug.trim().replaceAll(/[^A-Za-z0-9._-]/g, "");
  if (!safeSlug) return null;

  const skillPath = path.join(getSkillsRoot(), safeSlug, SKILL_FILE);
  let raw;
  try {
    raw = await fs.readFile(skillPath, "utf8");
  } catch {
    return null;
  }

  const parsed = parseFrontmatter(raw);
  return {
    slug: safeSlug,
    name: parsed.name || safeSlug,
    description: parsed.description,
    content: raw,
    path: skillPath,
  };
}

/**
 * Load multiple skills by slug in parallel. Silently drops missing entries.
 *
 * @param {string[]} slugs
 * @returns {Promise<Array<{slug: string, name: string, description: string|null, content: string, path: string}>>}
 */
export async function loadSkillsBySlugs(slugs = []) {
  if (!Array.isArray(slugs) || slugs.length === 0) return [];
  const results = await Promise.all(slugs.map((s) => loadSkillBySlug(s)));
  return results.filter(Boolean);
}

export { DEFAULT_REFRESH_MS, REPO_URL };

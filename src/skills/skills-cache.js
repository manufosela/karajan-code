/**
 * Local cache for installed OpenSkills, backed by `~/.karajan/skills-cache/`.
 *
 * The cache records WHEN each skill was last installed so we can skip
 * redundant `npx openskills install X` calls during the 7-day TTL window
 * (each call can take 10-30s even when the skill is already present).
 *
 * This is intentionally simple: one directory per skill name with a
 * `meta.json` describing the last install time. Skill content is NOT copied
 * to the cache — OpenSkills owns the real content on disk; we only track
 * freshness.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";

const CACHE_DIR_NAME = "skills-cache";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getCacheRoot() {
  return path.join(getKarajanHome(), CACHE_DIR_NAME);
}

function sanitize(name) {
  // Allow safe skill name characters, replace everything else with "_".
  return String(name || "").replaceAll(/[^A-Za-z0-9._-]/g, "_");
}

function metaPath(name) {
  return path.join(getCacheRoot(), sanitize(name), "meta.json");
}

/**
 * Read cached metadata for a skill. Returns null if missing or unreadable.
 * @param {string} name
 * @returns {Promise<{cachedAt: string, source?: string}|null>}
 */
export async function getCachedMeta(name) {
  if (!name) return null;
  try {
    const raw = await fs.readFile(metaPath(name), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.cachedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * True iff the skill was cached more recently than `ttlMs` ago.
 * @param {string} name
 * @param {number} [ttlMs=DEFAULT_TTL_MS]
 * @returns {Promise<boolean>}
 */
export async function isFresh(name, ttlMs = DEFAULT_TTL_MS) {
  const meta = await getCachedMeta(name);
  if (!meta) return false;
  const cachedTime = Date.parse(meta.cachedAt);
  if (Number.isNaN(cachedTime)) return false;
  return Date.now() - cachedTime < ttlMs;
}

/**
 * Record that a skill was just (re-)installed. Creates the cache subdir if
 * needed.
 * @param {string} name
 * @param {{ source?: string }} [opts]
 * @returns {Promise<void>}
 */
export async function recordInstall(name, opts = {}) {
  if (!name) return;
  const dir = path.join(getCacheRoot(), sanitize(name));
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    name,
    cachedAt: new Date().toISOString(),
    ...(opts.source ? { source: opts.source } : {}),
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

/**
 * Remove all cached skill metadata (does not touch real installed skills,
 * only clears the freshness tracker).
 * @returns {Promise<{removed: number}>}
 */
export async function clearCache() {
  const root = getCacheRoot();
  let removed = 0;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
      removed++;
    }
  } catch { /* cache dir does not exist — nothing to clear */ }
  return { removed };
}

/**
 * List cached skill names with their cachedAt timestamp, sorted oldest first.
 * @returns {Promise<Array<{name: string, cachedAt: string, fresh: boolean}>>}
 */
export async function listCached(ttlMs = DEFAULT_TTL_MS) {
  const root = getCacheRoot();
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await getCachedMeta(entry.name);
    if (!meta) continue;
    const cachedTime = Date.parse(meta.cachedAt);
    const fresh = !Number.isNaN(cachedTime) && (Date.now() - cachedTime < ttlMs);
    out.push({ name: meta.name || entry.name, cachedAt: meta.cachedAt, fresh });
  }
  out.sort((a, b) => a.cachedAt.localeCompare(b.cachedAt));
  return out;
}

export { DEFAULT_TTL_MS };

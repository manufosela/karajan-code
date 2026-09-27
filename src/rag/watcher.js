// KJC-TSK-0441 (RAG v2.28.0 PR1) — chokidar watcher. Live re-index of plans
// + onboarding + (opt) sources, debounced. PID file arbitrates a single daemon.
// KJC-TSK-0482 — source matcher derivado del registry (multi-lang: JS/Py/Rust/Go/Java).
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import chokidar from "chokidar";
import { deleteChunksBySource, projectSlug } from "./vec-store.js";
import { openProjectStore } from "./project-store.js";
import { makeGovernedEmbedder } from "./governed-embedder.js";
import { indexFile } from "./indexer.js";
import { getKarajanHome } from "../utils/paths.js";
import { getAllCodeExtensions } from "../lang/registry.js";

// KJC-TSK-0883 (ADR 0011): un watcher por proyecto, cada uno con su PID.
export const pidFilePath = (projectDir = process.cwd()) => join(getKarajanHome(), "watchers", `${projectSlug(projectDir)}.pid`);

/** Solo lo de ESTE proyecto: sus planes, su onboarding y (opt) sus fuentes. */
export function watchedPaths(projectDir, { withSources = false } = {}) {
  const slug = projectSlug(projectDir);
  const paths = [join(getKarajanHome(), "onboarding", `${slug}.md`), join(getKarajanHome(), "plans", slug)];
  return withSources ? [...paths, projectDir] : paths;
}
const DEFAULT_DEBOUNCE_MS = 1000;
const SKIP_SEGMENTS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".karajan", ".next", ".kj", "_diet", ".claude"]);
const SOURCE_EXTS = new Set(getAllCodeExtensions().map((e) => e.toLowerCase()));

export function isWatchable(path) {
  if (path.includes("/.karajan/onboarding/")) return /\.md$/.test(path);
  if (path.includes("/.karajan/plans/")) return /\.json$/.test(path);
  if (path.split("/").some((seg) => SKIP_SEGMENTS.has(seg))) return false;
  return SOURCE_EXTS.has(extname(path).toLowerCase());
}

export function startWatcher({ projectDir, config, logger = console, debounceMs = DEFAULT_DEBOUNCE_MS, withSources = false } = {}) {
  if (!projectDir) throw new Error("startWatcher: projectDir is required");
  const slug = projectSlug(projectDir);
  const dim = config?.rag?.embedder?.dim || 768;
  const db = openProjectStore({ projectDir, dim });
  const embedder = makeGovernedEmbedder(config);
  const watcher = chokidar.watch(watchedPaths(projectDir, { withSources }), { ignoreInitial: true, persistent: true });
  const pending = new Map();
  const flush = async (p) => {
    pending.delete(p);
    if (!existsSync(p)) { deleteChunksBySource(db, p); logger.info?.(`[rag-watcher] removed → ${p}`); return; }
    if (!isWatchable(p)) return;
    try { const r = await indexFile(p, { db, embedder, logger, project: slug }); logger.info?.(`[rag-watcher] reindexed ${p} → ${r.indexed} chunk(s)`); }
    catch (err) { logger.warn?.(`[rag-watcher] reindex failed for ${p}: ${err.message}`); }
  };
  const schedule = (p) => { if (pending.has(p)) clearTimeout(pending.get(p)); pending.set(p, setTimeout(() => flush(p), debounceMs)); };
  watcher.on("add", schedule).on("change", schedule).on("unlink", schedule).on("error", (err) => logger.warn?.(`[rag-watcher] ${err.message}`));
  return async function stop() {
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    await watcher.close();
    try { db.close(); } catch { /* already closed */ }
  };
}

export function writePidFile(projectDir, pid = process.pid) {
  const file = pidFilePath(projectDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, String(pid), "utf8");
}
export function clearPidFile(projectDir) { if (existsSync(pidFilePath(projectDir))) unlinkSync(pidFilePath(projectDir)); }
export function readPidFile(projectDir) {
  if (!existsSync(pidFilePath(projectDir))) return null;
  const pid = Number(readFileSync(pidFilePath(projectDir), "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}
export function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

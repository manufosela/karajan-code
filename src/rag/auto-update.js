// KJC-TSK-0455 PR2 — Pre-run drift check + post-merge hook installer.
// Keeps the local RAG index aligned with HEAD so retrieval never serves
// stale code without the user having to run `kj rag index` by hand.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

import { projectSlug, getLastIndexedCommit, setLastIndexedCommit } from "./vec-store.js";
import { indexProject, indexProjectDelta } from "./indexer.js";
import { readRefreshedPaths, untrackedFiles, writeRefreshedPaths } from "./worktree-files.js";
import { startBootstrap, stopBootstrap } from "./bootstrap-index.js";
import { indexLeasePath, stopLeaseHolder } from "./pid-lease.js";
import { ragExclude } from "./indexable.js";
import { makeGovernedEmbedder } from "./governed-embedder.js";
import { openProjectStore } from "./project-store.js";
import { readEmbedSchema } from "./embed-schema.js";
import { EMBED_SCHEMA } from "./embed-header.js";
import { getKarajanHome } from "../utils/paths.js";

// Said once per process and project: every query of a session would repeat it otherwise.
const warnedFor = new Set();
const warnOnce = (logger, key, msg) => { if (!warnedFor.has(key)) { warnedFor.add(key); logger.warn?.(msg); } };

/** How many project files the index holds (a prefix compare: paths may hold % or _). */
const countSources = (db, slug, projectDir) => {
  const prefix = `${projectDir.replace(/[\\/]+$/, "")}/`;
  return db.prepare("SELECT COUNT(DISTINCT source) AS n FROM chunks WHERE project_slug = ? AND substr(source, 1, ?) = ?").get(slug, prefix.length, prefix).n;
};

// The pre-query refresh reindexes at most this many changed files (config.rag.autoUpdate.maxFiles).
export const DEFAULT_MAX_DRIFT_FILES = 25;
const HOOK_SRC = resolve(fileURLToPath(import.meta.url), "../../../scripts/git-hooks/post-merge");

// KJC-TSK-1174 (RAG-A2): no index yet. It is built in the background, once; the session
// does not wait. A recent attempt that died (no Ollama) is not retried blindly.
async function bootstrapInBackground({ projectDir, slug, head, logger }) {
  // HU-2758: an indexer past MAX_RUN_MS is stopped first: this project's, then whichever holds the machine lease
  // (an orphan of an older build that no marker names). A failure here never keeps the bootstrap from happening.
  for (const stopped of [await stopBootstrap(projectDir).catch(() => null), await stopLeaseHolder(indexLeasePath()).catch(() => null)]) {
    if (!stopped) continue;
    logger.info?.(`[rag] stopped the background index of ${stopped.slug ?? slug} (pid ${stopped.pid}): it ran past 60 min`);
    // The stop never reached the marker (busy mutex): nothing on file says it was stopped, so it may start again.
    if (stopped.marked === false) warnOnce(logger, `bootstrap-unmarked:${projectDir}`, `[rag] the stop of the background index of ${stopped.slug ?? slug} (pid ${stopped.pid}) could not be noted: it may be started again on the next command; run kj rag index --with-sources by hand`);
  }
  const boot = startBootstrap(projectDir);
  if (boot.stopped === "max-run") {
    warnOnce(logger, `bootstrap-stopped:${projectDir}`, `[rag] the background index of ${slug} ran past 60 min and was stopped: run kj rag index --with-sources by hand`);
    return { skipped: true, reason: "bootstrap-failed", head };
  }
  if (boot.busy) {
    warnOnce(logger, `bootstrap-busy:${projectDir}`, `[rag] ${slug} has no index yet: another background index is running (${boot.busy.slug ?? "?"}, pid ${boot.busy.pid ?? "?"}); it is tried again on the next command`);
    return { skipped: true, reason: "bootstrap-queued", holder: boot.busy, head };
  }
  if (boot.recent) {
    warnOnce(logger, `bootstrap:${projectDir}`, `[rag] ${slug} has no index and the background indexing did not finish: run kj rag index --with-sources`);
    return { skipped: true, reason: "bootstrap-failed", head };
  }
  warnOnce(logger, `bootstrap:${projectDir}`, `[rag] ${slug} has no index yet: indexing it in the background (pid ${boot.pid}); queries answer from it once it is done`);
  return { skipped: true, reason: "bootstrapping", pid: boot.pid, head };
}

// KJC-TSK-1171 (RAG-B): an index built before the embedded header holds vectors a
// query by file or symbol name cannot reach. Small, it is rebuilt here; large, the
// query answers from it and says once how to rebuild.
async function rebuildOldSchema({ db, slug, projectDir, config, logger, head, maxFiles }, schema) {
  const sources = countSources(db, slug, projectDir);
  if (sources > maxFiles) {
    warnOnce(logger, projectDir, `[rag] the index of ${slug} predates the embedded header (schema ${schema} < ${EMBED_SCHEMA}): answering from it as it is; rebuild it with kj rag index --with-sources`);
    return { skipped: true, reason: "embed-schema-old", sources, head };
  }
  logger.info?.(`[rag] the index of ${slug} predates the embedded header (schema ${schema} < ${EMBED_SCHEMA}); rebuilding ${sources} source(s)`);
  const totals = await indexProject(projectDir, { db, embedder: makeGovernedEmbedder(config), karajanHome: getKarajanHome(), logger, withSources: true, exclude: ragExclude(config) });
  if (totals.head) setLastIndexedCommit(db, slug, totals.head);
  return { ran: true, rebuilt: true, totals };
}

// KJC-TSK-1174 (RAG-A1): the drift is measured up to the files on disk, untracked ones
// included, so a query sees what the session is writing before it is committed.
// The dirty paths of the last refresh count too: reverted or deleted since, they hold stale chunks.
async function deltaUpdate({ db, slug, projectDir, config, logger, head, maxFiles }, since) {
  const { stdout } = await execa("git", ["-C", projectDir, "diff", "--name-only", "-z", since]);
  const dirty = [...stdout.split("\0").filter(Boolean), ...(await untrackedFiles(projectDir))];
  const reconcile = readRefreshedPaths(projectDir).filter((p) => !dirty.includes(p));
  const changed = dirty.length + reconcile.length;
  if (changed === 0) return { skipped: true, head };
  if (changed > maxFiles) {
    logger.warn?.(`[rag] ${changed} file(s) changed since the last index (more than ${maxFiles}): answering from the index as it is; bring it up to date with kj rag index --since auto`);
    return { skipped: true, reason: "drift-too-large", changed, head };
  }
  logger.info?.(`[rag] drift detected (${since.slice(0, 7)} → ${head.slice(0, 7)}, ${changed} file(s)); running delta update`);
  const totals = await indexProjectDelta(projectDir, { db, embedder: makeGovernedEmbedder(config), since, logger, exclude: ragExclude(config), worktree: true, reconcile });
  if (totals.head) setLastIndexedCommit(db, slug, totals.head);
  writeRefreshedPaths(projectDir, dirty);
  return { ran: true, totals };
}

export async function maybeAutoUpdate({ projectDir, config, logger = console, flags = {} } = {}) {
  // commander turns `--no-rag-update` into flags.ragUpdate === false.
  if (flags?.ragUpdate === false || config?.rag?.autoUpdate?.onRun === false) return { skipped: true };
  if (!projectDir || !existsSync(join(projectDir, ".git"))) return { skipped: true };
  let head;
  try { const r = await execa("git", ["-C", projectDir, "rev-parse", "HEAD"]); head = r.stdout.trim(); }
  catch { return { skipped: true }; }
  const slug = projectSlug(projectDir);
  const db = openProjectStore({ projectDir, dim: config?.rag?.embedder?.dim || 768 });
  try {
    const since = getLastIndexedCommit(db, slug);
    if (!since) return await bootstrapInBackground({ projectDir, slug, head, logger });
    // KJC-BUG-0304: a drift of hundreds of files (an index weeks old) reindexed the
    // repo for half an hour before the query answered. Past the bound the query
    // answers from the index as it is, and says how to bring it up to date.
    const ctx = { db, slug, projectDir, config, logger, head, maxFiles: config?.rag?.autoUpdate?.maxFiles ?? DEFAULT_MAX_DRIFT_FILES };
    const schema = readEmbedSchema(projectDir);
    // Awaited here, inside the try: the catch must see their errors and the finally must not close the store under them.
    if (schema < EMBED_SCHEMA) return await rebuildOldSchema(ctx, schema);
    return await deltaUpdate(ctx, since);
  } catch (err) {
    // Said once per process: an embedder that is down would repeat it on every query otherwise.
    warnOnce(logger, `failed:${projectDir}`, `[rag] auto-update failed (${err.message}); continuing without refresh`);
    return { failed: true, error: err.message };
  } finally { db.close(); }
}

// KJC-BUG-0100 — Resolve the hooks dir git actually honours. When a repo is
// hardened `git config core.hooksPath` points at `.karajan/hooks` and git
// ignores `.git/hooks/` entirely, so a hook written there never fires.
export async function resolveHooksDir(projectDir) {
  if (!existsSync(join(projectDir, ".git"))) throw new Error(`Not a git repository: ${projectDir}`);
  let hooksPath = "";
  try {
    const r = await execa("git", ["-C", projectDir, "config", "--local", "core.hooksPath"]);
    hooksPath = r.stdout.trim();
  } catch { /* unset → git uses .git/hooks */ }
  if (hooksPath) {
    return { dir: isAbsolute(hooksPath) ? hooksPath : join(projectDir, hooksPath), hooksPath };
  }
  return { dir: join(projectDir, ".git", "hooks"), hooksPath: "" };
}

export async function installPostMergeHook({ projectDir, logger = console } = {}) {
  const { dir: hooksDir, hooksPath } = await resolveHooksDir(projectDir);
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  const target = join(hooksDir, "post-merge");
  const src = readFileSync(HOOK_SRC, "utf8");
  if (existsSync(target)) {
    const current = readFileSync(target, "utf8");
    // Another kj-managed hook (e.g. harden's post-merge) already reindexes.
    if (!current.includes("KJC-TSK-0455") && /kj\s+rag\s+index/.test(current)) {
      return { skipped: true, covered: true, target, hooksPath };
    }
    if (!current.includes("KJC-TSK-0455")) {
      logger.warn?.(`[rag] ${target} already exists and was not installed by kj; leaving untouched`);
      return { skipped: true, target, hooksPath };
    }
  }
  writeFileSync(target, src);
  chmodSync(target, 0o755);
  return { installed: true, target, hooksPath };
}

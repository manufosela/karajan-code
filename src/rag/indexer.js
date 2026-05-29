// KJC-PCS-0049 Step 4 — Indexer for the RAG pipeline. Wires the three
// previous modules together: chunker → embedder → vec store. The CLI
// (Step 6) drives this; Step 5's retriever reads what gets persisted
// here. A chokidar watcher version stays out of scope for v2.22.0 —
// indexProject() is on-demand from `kj rag index`, which keeps the
// failure mode simple (re-run to refresh).
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { execa } from "execa";

import { chunkMarkdown, chunkPlan, chunkSource } from "./chunker.js";
import { insertChunk, deleteChunksBySource } from "./vec-store.js";

const CODE_EXT_RE = /\.(js|mjs|cjs|ts|tsx|jsx)$/;
const SKIP_SEGMENTS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".karajan", ".next", ".kj", "_diet"]);

const ONBOARDING_DIR = "onboarding", PLANS_DIR = "plans";

function detectKind(path) {
  const ext = extname(path).toLowerCase();
  const base = path.split("/").pop() || "";
  if (ext === ".json" && (/^plan-.+\.json$/i.test(base) || path.includes(`/${PLANS_DIR}/`))) return "plan";
  if (ext === ".md") return path.includes(`/${ONBOARDING_DIR}/`) ? "onboarding" : "plan";
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(ext)) return "code";
  return null;
}

function chunksFor(path, kind) {
  const text = readFileSync(path, "utf8");
  if (kind === "plan" && extname(path) === ".json") {
    try { return chunkPlan(JSON.parse(text), { path }); }
    catch { return []; }
  }
  if (kind === "plan" || kind === "onboarding") {
    return chunkMarkdown(text, { path, kind });
  }
  if (kind === "code") return chunkSource(text, { path });
  return [];
}

/**
 * Index a single file. Returns `{ indexed, failed }`. Idempotent —
 * pre-existing chunks for this `source` path are deleted before the
 * fresh batch is written, so a second call against the same file
 * leaves the store with exactly the latest chunks (no duplicates).
 */
export async function indexFile(path, { db, embedder, logger = console, project = null } = {}) {
  if (!existsSync(path)) { logger.warn?.(`[rag-indexer] file not found: ${path}`); return { indexed: 0, failed: 0 }; }
  const kind = detectKind(path);
  if (!kind) { logger.warn?.(`[rag-indexer] unknown kind: ${path}`); return { indexed: 0, failed: 0 }; }
  const chunks = chunksFor(path, kind);
  if (!chunks.length) return { indexed: 0, failed: 0 };
  deleteChunksBySource(db, path);
  let indexed = 0;
  let failed = 0;
  for (const ch of chunks) {
    try {
      const embedding = await embedder.embed(ch.text);
      insertChunk(db, { source: path, kind: ch.metadata.kind || kind, text: ch.text, metadata: ch.metadata, embedding, project });
      indexed += 1;
    } catch (err) {
      failed += 1;
      logger.warn?.(`[rag-indexer] embed failed for ${path} (${chunkLabel(ch)}): ${err.message}`);
    }
  }
  logger.info?.(`[rag-indexer] ${relative(process.cwd(), path)} → ${indexed} chunk(s) (${failed} failed)`);
  return { indexed, failed };
}

function chunkLabel(ch) {
  return ch.metadata?.hu_id || ch.metadata?.symbol || ch.metadata?.headingPath?.join(" > ") || "block";
}

async function listFiles(dir, predicate) {
  const out = [];
  async function walk(d) {
    let ents; try { ents = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else if (e.isFile() && predicate(p)) out.push(p);
    }
  }
  await walk(dir); return out;
}

/**
 * Index every Karajan-managed asset for the project: every plan-*.json
 * under `<karajanHome>/plans/<slug>/`, the onboarding brief under
 * `<karajanHome>/onboarding/`, and (optionally) source files under the
 * projectDir. Sources are gated behind `withSources: true` because
 * indexing tens of thousands of files is expensive — the CLI exposes
 * it as `--with-sources`.
 */
export async function indexProject(projectDir, { db, embedder, karajanHome, logger = console, withSources = false } = {}) {
  const totals = { indexed: 0, failed: 0, files: 0 };
  const slug = projectDir.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase() || "project";
  const planRoot = join(karajanHome, PLANS_DIR, slug);
  if (existsSync(planRoot)) {
    const plans = await listFiles(planRoot, (p) => /plan-.*\.json$/.test(p));
    for (const p of plans) {
      const r = await indexFile(p, { db, embedder, logger, project: slug });
      totals.indexed += r.indexed; totals.failed += r.failed; totals.files += 1;
    }
  }
  const onboarding = join(karajanHome, ONBOARDING_DIR, `${slug}.md`);
  if (existsSync(onboarding)) {
    const r = await indexFile(onboarding, { db, embedder, logger, project: slug });
    totals.indexed += r.indexed; totals.failed += r.failed; totals.files += 1;
  }
  if (withSources) {
    // KJC-BUG-0062: `.kj/worktrees/HU-*/` contains git worktrees Karajan spawns
    // per HU during `kj run`; they hold complete copies of `src/` that
    // duplicate every chunk and contaminate retrieval scores. `_diet` is the
    // tests/_diet/ sandbox used by the test-diet audit harness — never user
    // code. Skip both.
    const sources = await listFiles(projectDir, (p) => CODE_EXT_RE.test(p) && !p.split("/").some((seg) => SKIP_SEGMENTS.has(seg)));
    for (const s of sources) {
      const r = await indexFile(s, { db, embedder, logger, project: slug });
      totals.indexed += r.indexed; totals.failed += r.failed; totals.files += 1;
    }
  }
  return totals;
}

/**
 * KJC-TSK-0455 — Re-index only the files changed between `since` and HEAD.
 * `git diff --name-status -z` drives the work: A/M re-embed, D drop chunks,
 * R drops old + indexes new. Returns `{ indexed, failed, files, deleted, head }`;
 * `head` lets callers persist via setLastIndexedCommit. Throws on diff failure
 * (shallow clone, unknown ref) so the CLI can fall back to a full reindex.
 */
export async function indexProjectDelta(projectDir, { db, embedder, since, logger = console } = {}) {
  const totals = { indexed: 0, failed: 0, files: 0, deleted: 0, head: null };
  const slug = projectDir.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase() || "project";
  const { stdout: head } = await execa("git", ["-C", projectDir, "rev-parse", "HEAD"]);
  totals.head = head.trim();
  if (totals.head === since) return totals;
  const { stdout } = await execa("git", ["-C", projectDir, "diff", "--name-status", "-z", since, "HEAD"]);
  const parts = stdout.split("\0").filter(Boolean);
  const ops = []; // { kind: 'del'|'idx', p }
  for (let i = 0; i < parts.length; i += 1) {
    const s = parts[i];
    if (s.startsWith("R")) { ops.push({ kind: "del", p: parts[++i] }, { kind: "idx", p: parts[++i] }); }
    else if (s === "D") { ops.push({ kind: "del", p: parts[++i] }); }
    else { ops.push({ kind: "idx", p: parts[++i] }); }
  }
  for (const { kind, p } of ops) {
    if (p.split("/").some((seg) => SKIP_SEGMENTS.has(seg))) continue;
    if (!CODE_EXT_RE.test(p)) continue;
    const abs = isAbsolute(p) ? p : join(projectDir, p);
    if (kind === "del") {
      totals.deleted += deleteChunksBySource(db, abs);
      logger.info?.(`[rag-indexer] delta delete ${relative(process.cwd(), abs)}`);
    } else if (existsSync(abs)) {
      const r = await indexFile(abs, { db, embedder, logger, project: slug });
      totals.indexed += r.indexed; totals.failed += r.failed; totals.files += 1;
    }
  }
  return totals;
}

// KJC-TSK-0455 PR2 — Pre-run drift check + post-merge hook installer.
// Keeps the local RAG index aligned with HEAD so retrieval never serves
// stale code without the user having to run `kj rag index` by hand.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

import { openVecStore, projectSlug, getLastIndexedCommit, setLastIndexedCommit } from "./vec-store.js";
import { indexProjectDelta } from "./indexer.js";
import { makeEmbedder } from "./embedders/factory.js";

const HOOK_SRC = resolve(fileURLToPath(import.meta.url), "../../../scripts/git-hooks/post-merge");

export async function maybeAutoUpdate({ projectDir, config, logger = console, flags = {} } = {}) {
  // commander turns `--no-rag-update` into flags.ragUpdate === false.
  if (flags?.ragUpdate === false || config?.rag?.autoUpdate?.onRun === false) return { skipped: true };
  if (!projectDir || !existsSync(join(projectDir, ".git"))) return { skipped: true };
  let head;
  try { const r = await execa("git", ["-C", projectDir, "rev-parse", "HEAD"]); head = r.stdout.trim(); }
  catch { return { skipped: true }; }
  const slug = projectSlug(projectDir);
  const db = openVecStore({ dim: config?.rag?.embedder?.dim || 768 });
  try {
    const since = getLastIndexedCommit(db, slug);
    if (!since || since === head) return { skipped: true, head };
    logger.info?.(`[rag] drift detected (${since.slice(0, 7)} → ${head.slice(0, 7)}); running delta update`);
    const totals = await indexProjectDelta(projectDir, { db, embedder: makeEmbedder(config), since, logger });
    if (totals.head) setLastIndexedCommit(db, slug, totals.head);
    return { ran: true, totals };
  } catch (err) {
    logger.warn?.(`[rag] auto-update failed (${err.message}); continuing without refresh`);
    return { failed: true, error: err.message };
  } finally { db.close(); }
}

export function installPostMergeHook({ projectDir, logger = console } = {}) {
  const hooksDir = join(projectDir, ".git", "hooks");
  if (!existsSync(join(projectDir, ".git"))) throw new Error(`Not a git repository: ${projectDir}`);
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  const target = join(hooksDir, "post-merge");
  const src = readFileSync(HOOK_SRC, "utf8");
  if (existsSync(target) && !readFileSync(target, "utf8").includes("KJC-TSK-0455")) {
    logger.warn?.(`[rag] ${target} already exists and was not installed by kj; leaving untouched`);
    return { skipped: true, target };
  }
  writeFileSync(target, src);
  chmodSync(target, 0o755);
  return { installed: true, target };
}

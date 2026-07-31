/**
 * library — the distilled engineering canon as its own RAG collection
 * (KJC-TSK-0697). Markdown cards from `<pkg>/library/`, `~/.karajan/library/`
 * and `<project>/.karajan/library/` index into the SAME global rag.db,
 * isolated by project="library" + kind="library", so `kj rag query --library`
 * reaches the canon and normal project queries never see it. The architect
 * consults it to ground the greenfield alternative (KJC-TSK-0696).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { chunkMarkdown } from "./chunker.js";
import { insertChunk, deleteChunksBySource, findChunkByHash } from "./vec-store.js";

export const LIBRARY_PROJECT = "library";

const SHIPPED_LIBRARY_DIR = fileURLToPath(new URL("../../library", import.meta.url));

/** Existing library dirs, shipped canon first. */
export function libraryDirs({ pkgLibraryDir = SHIPPED_LIBRARY_DIR, home = os.homedir(), projectDir = process.cwd() } = {}) {
  const candidates = [pkgLibraryDir, join(home, ".karajan", "library"), join(projectDir, ".karajan", "library")];
  return candidates.filter((d) => existsSync(d));
}

/**
 * Index every markdown card found in the library dirs. Idempotent: chunks
 * re-index per source and identical bodies skip the embedder (content-hash
 * dedup within the library project).
 */
export async function indexLibrary({ db, embedder, logger = console, pkgLibraryDir, home, projectDir } = {}) {
  let indexed = 0, failed = 0, files = 0;
  for (const dir of libraryDirs({ pkgLibraryDir, home, projectDir })) {
    for (const name of readdirSync(dir)) {
      if (extname(name).toLowerCase() !== ".md") continue;
      const path = join(dir, name);
      files += 1;
      const chunks = chunkMarkdown(readFileSync(path, "utf8"), { path, kind: "library" });
      const hashed = chunks.map((ch) => ({ ch, contentHash: createHash("sha256").update(ch.text).digest("hex") }));
      // Unchanged card (every chunk body already known) → skip before the
      // delete, so idempotent re-runs never touch the embedder.
      if (hashed.length && hashed.every(({ contentHash }) => findChunkByHash(db, contentHash, LIBRARY_PROJECT))) continue;
      deleteChunksBySource(db, path);
      for (const { ch, contentHash } of hashed) {
        try {
          if (findChunkByHash(db, contentHash, LIBRARY_PROJECT)) continue;
          const embedding = await embedder.embed(ch.text);
          insertChunk(db, { source: path, kind: "library", text: ch.text, metadata: ch.metadata, embedding, project: LIBRARY_PROJECT, contentHash });
          indexed += 1;
        } catch (err) {
          failed += 1;
          logger.warn?.(`[rag-library] embed failed for ${path}: ${err.message}`);
        }
      }
    }
  }
  if (files) logger.info?.(`[rag-library] ${files} card(s) → ${indexed} chunk(s) (${failed} failed)`);
  return { files, indexed, failed };
}

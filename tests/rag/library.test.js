// KJC-TSK-0697 — library corpus: distilled engineering canon as its own RAG
// collection (project="library", kind="library"), isolated from code chunks
// by filters the retriever already supports. The architect queries it to
// ground the greenfield alternative (KJC-TSK-0696) in citable canon.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openVecStore } from "../../src/rag/vec-store.js";
import { indexLibrary, libraryDirs } from "../../src/rag/library.js";
import { query } from "../../src/rag/retriever.js";

const embedder = { dim: 8, embed: async (t) => new Array(8).fill(0).map((_, i) => ((t.length + i) % 7) / 7) };

let tmp, db, pkgDir, homeDir, projDir;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kj-library-"));
  process.env.KJ_RAG_DB = join(tmp, "rag.db");
  db = openVecStore({ dim: 8 });
  pkgDir = join(tmp, "pkg-library");
  homeDir = join(tmp, "home");
  projDir = join(tmp, "proj");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(join(homeDir, ".karajan", "library"), { recursive: true });
  mkdirSync(join(projDir, ".karajan", "library"), { recursive: true });
  writeFileSync(join(pkgDir, "lamport.md"), "# Logical clocks\n\nHappened-before ordering without a global clock.\n");
  writeFileSync(join(homeDir, ".karajan", "library", "user-card.md"), "# Outbox pattern\n\nAtomic DB write plus reliable event publication.\n");
});
afterEach(() => {
  try { db.close(); } catch { /* closed */ }
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KJ_RAG_DB;
});

describe("rag/library", () => {
  it("libraryDirs covers shipped, user-home and project dirs that exist", () => {
    const dirs = libraryDirs({ pkgLibraryDir: pkgDir, home: homeDir, projectDir: projDir });
    expect(dirs).toContain(pkgDir);
    expect(dirs).toContain(join(homeDir, ".karajan", "library"));
    expect(dirs).toContain(join(projDir, ".karajan", "library"));
    expect(libraryDirs({ pkgLibraryDir: join(tmp, "nope"), home: join(tmp, "nope2"), projectDir: join(tmp, "nope3") })).toEqual([]);
  });

  it("indexes as kind=library/project=library, idempotent, invisible to project queries", async () => {
    const opts = { db, embedder, pkgLibraryDir: pkgDir, home: homeDir, projectDir: projDir, logger: { info() {}, warn() {} } };
    expect((await indexLibrary(opts)).indexed).toBeGreaterThan(0);
    expect((await indexLibrary(opts)).indexed).toBe(0); // content-hash dedup: nothing re-embedded
    const hits = await query(db, embedder, "ordering without a global clock", { project: "library", where: "kind=library", topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.kind === "library")).toBe(true);
    const proj = await query(db, embedder, "ordering without a global clock", { project: "some-app", topK: 5 });
    expect(proj.filter((h) => h.kind === "library")).toEqual([]);
  });
});

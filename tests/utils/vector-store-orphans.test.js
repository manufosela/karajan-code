import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { collectVectorStoreOrphans } from "../../src/utils/vector-store-orphans.js";
import { openVecStore, insertChunk } from "../../src/rag/vec-store.js";

function makeEmbedding(dim = 768) {
  const buf = new Float32Array(dim);
  for (let i = 0; i < dim; i++) buf[i] = Math.random();
  return buf;
}

describe("vector-store-orphans", () => {
  let tmpDb;
  let roots;
  let originalDb;
  beforeEach(async () => {
    tmpDb = await fs.mkdtemp(path.join(os.tmpdir(), "vec-store-orphans-"));
    originalDb = process.env.KJ_RAG_DB;
    process.env.KJ_RAG_DB = path.join(tmpDb, "rag.db");
    roots = await fs.mkdtemp(path.join(os.tmpdir(), "vec-store-orphans-roots-"));
  });
  afterEach(async () => {
    if (originalDb === undefined) delete process.env.KJ_RAG_DB;
    else process.env.KJ_RAG_DB = originalDb;
    await fs.rm(tmpDb, { recursive: true, force: true });
    await fs.rm(roots, { recursive: true, force: true });
  });

  it("returns empty rows on a fresh rag.db", async () => {
    const { rows, orphans, errors } = await collectVectorStoreOrphans({ projectRoots: [roots] });
    expect(rows).toEqual([]);
    expect(orphans).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("marks slugs whose basename is not in roots as orphan and resolves the rest", async () => {
    await fs.mkdir(path.join(roots, "live-project"), { recursive: true });
    const db = openVecStore();
    insertChunk(db, { source: "/x/live-project/a.js", kind: "code", text: "a", embedding: makeEmbedding(), project: "live-project" });
    insertChunk(db, { source: "/old/gone-project/a.js", kind: "code", text: "b", embedding: makeEmbedding(), project: "gone-project" });
    db.close();
    const { rows, orphans } = await collectVectorStoreOrphans({ projectRoots: [roots] });
    const live = rows.find((r) => r.slug === "live-project");
    const gone = rows.find((r) => r.slug === "gone-project");
    expect(live.orphan).toBe(false);
    expect(live.resolvedDir).toBe(path.join(roots, "live-project"));
    expect(gone.orphan).toBe(true);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].command).toMatch(/^sqlite3 /);
    expect(orphans[0].command).toContain("project_slug='gone-project'");
  });
});

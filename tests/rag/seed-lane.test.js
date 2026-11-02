// HU-2755 (1/2): a lane's index is seeded from the main checkout's store, paths rewritten.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedLaneIndex } from "../../src/rag/seed-lane.js";
import { EMBED_SCHEMA } from "../../src/rag/embed-header.js";
import { readEmbedSchema, writeEmbedSchema } from "../../src/rag/embed-schema.js";
import { readRefreshedPaths, writeRefreshedPaths } from "../../src/rag/worktree-files.js";
import { openVecStore, insertChunk, searchBM25, searchSimilar, projectSlug, setLastIndexedCommit, getLastIndexedCommit } from "../../src/rag/vec-store.js";

const DIM = 8;
const vec = (i) => { const v = new Float32Array(DIM); v[i] = 1; return v; };
const git = (cwd, ...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8" }).trim();

let root, main, lane, mainDb, laneDb, savedEnv;

const seedMain = ({ marker = true, watermark = true } = {}) => {
  const db = openVecStore({ dim: DIM, path: mainDb });
  const slug = projectSlug(main);
  insertChunk(db, { source: `${main}/src/a.js`, kind: "code", text: "alpha unique token", metadata: { source: `${main}/src/a.js`, line: 1 }, embedding: vec(0), project: slug });
  insertChunk(db, { source: `${main}/src/b%_.js`, kind: "code", text: "beta other token", metadata: { source: `${main}/src/b%_.js` }, embedding: vec(1), project: slug });
  insertChunk(db, { source: "/home/u/.karajan/plans/p/plan.md", kind: "plan", text: "plan outside root", metadata: null, embedding: vec(2), project: slug });
  if (watermark) setLastIndexedCommit(db, slug, git(main, "rev-parse", "HEAD"));
  db.close();
  if (marker) writeEmbedSchema(main);
  writeRefreshedPaths(main, ["src/a.js"]);
};

beforeEach(() => {
  vi.stubEnv("KJ_RAG_DB", "");
  root = realpathSync(mkdtempSync(join(tmpdir(), "kj-seed-lane-")));
  main = join(root, "main");
  lane = join(root, "lane-x");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "commit", "-q", "--allow-empty", "-m", "base");
  git(main, "worktree", "add", "-q", lane, "-b", "lane-x");
  mainDb = join(main, ".karajan", "rag.db");
  laneDb = join(lane, ".karajan", "rag.db");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("seedLaneIndex", () => {
  it("copies main's store and rewrites every path, slug and watermark to the lane", async () => {
    seedMain();
    const before = readFileSync(mainDb);
    const r = await seedLaneIndex({ mainDir: main, laneDir: lane, dim: DIM });
    expect(r).toMatchObject({ seeded: true, chunks: 2, commit: git(main, "rev-parse", "HEAD") });
    expect(readFileSync(mainDb).equals(before)).toBe(true);
    const db = openVecStore({ dim: DIM, path: laneDb });
    try {
      const rows = db.prepare("SELECT source, metadata, project_slug FROM chunks").all();
      for (const row of rows) {
        expect(row.source.startsWith(`${lane}/`)).toBe(true);
        expect(JSON.parse(row.metadata).source).toBe(row.source);
        expect(row.project_slug).toBe(projectSlug(lane));
      }
      expect(rows.map((x) => x.source)).toContain(`${lane}/src/b%_.js`);
      expect(getLastIndexedCommit(db, projectSlug(lane))).toBe(git(main, "rev-parse", "HEAD"));
      expect(getLastIndexedCommit(db, projectSlug(main))).toBeNull();
      expect(db.prepare("SELECT COUNT(*) n FROM vec_chunks").get().n).toBe(2);
      expect(() => db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('integrity-check')")).not.toThrow();
      expect(searchBM25(db, "alpha", 5, { project: projectSlug(lane) }).map((h) => h.source)).toEqual([`${lane}/src/a.js`]);
      const hits = searchSimilar(db, vec(2), 5, { project: projectSlug(lane) });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.source.startsWith(`${lane}/`))).toBe(true);
    } finally { db.close(); }
    expect(readRefreshedPaths(lane)).toEqual(["src/a.js"]);
    expect(readEmbedSchema(lane)).toBe(EMBED_SCHEMA);
  });

  it.each([
    ["no main db", "no-main-index", () => {}, {}],
    ["no watermark", "no-watermark", () => seedMain({ watermark: false }), {}],
    ["marker missing", "embed-schema-old", () => seedMain({ marker: false }), {}],
    ["marker schema 1", "embed-schema-old", () => { seedMain({ marker: false }); writeEmbedSchema(main, 1); }, {}],
    ["dim mismatch", "dim-mismatch", () => seedMain(), { dim: 16 }],
    ["shared db", "shared-db", () => { seedMain(); vi.stubEnv("KJ_RAG_DB", mainDb); }, {}],
    ["lane db present", "lane-has-index", () => { seedMain(); mkdirSync(join(lane, ".karajan")); writeFileSync(laneDb, "keep"); }, {}],
    ["rows all outside main", "paths-unmatched", () => { seedMain(); main = `${main}/`; }, {}],
  ])("refuses without leaving a lane index: %s", async (_name, reason, arrange, opts) => {
    arrange();
    const r = await seedLaneIndex({ mainDir: main, laneDir: lane, dim: DIM, ...opts });
    expect(r).toEqual({ seeded: false, reason });
    const left = existsSync(join(lane, ".karajan")) ? readdirSync(join(lane, ".karajan")) : [];
    expect(left).toEqual(reason === "lane-has-index" ? ["rag.db"] : []);
  });

  it("includes a row a second connection wrote to main's WAL and had not checkpointed", async () => {
    seedMain();
    const other = openVecStore({ dim: DIM, path: mainDb });
    try {
      insertChunk(other, { source: `${main}/src/c.js`, kind: "code", text: "gamma wal row", embedding: vec(3), project: projectSlug(main) });
      const r = await seedLaneIndex({ mainDir: main, laneDir: lane, dim: DIM });
      expect(r).toMatchObject({ seeded: true, chunks: 3 });
    } finally { other.close(); }
    const db = openVecStore({ dim: DIM, path: laneDb });
    try { expect(db.prepare("SELECT source FROM chunks WHERE text = 'gamma wal row'").get().source).toBe(`${lane}/src/c.js`); } finally { db.close(); }
  });
});

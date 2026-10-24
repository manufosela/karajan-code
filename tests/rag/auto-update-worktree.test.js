// KJC-TSK-1174 (RAG-A1): the pre-query refresh covers what is being written, not only what
// is committed, and an embedder that is down is said once per process, never per call.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { since: null, dbPath: null };
vi.mock("../../src/rag/project-store.js", () => ({ openProjectStore: vi.fn(() => ({ close: vi.fn() })), projectDbPath: vi.fn(() => state.dbPath) }));
vi.mock("../../src/rag/vec-store.js", async () => {
  const real = await vi.importActual("../../src/rag/vec-store.js");
  return { ...real, projectSlug: vi.fn(() => "p"), getLastIndexedCommit: vi.fn(() => state.since), setLastIndexedCommit: vi.fn() };
});
vi.mock("../../src/rag/indexer.js", () => ({ indexProject: vi.fn(), indexProjectDelta: vi.fn(async () => ({ indexed: 1, files: 1, head: "h" })) }));
vi.mock("../../src/rag/governed-embedder.js", () => ({ makeGovernedEmbedder: vi.fn(() => ({})) }));
vi.mock("../../src/rag/embed-schema.js", async () => {
  const { EMBED_SCHEMA } = await import("../../src/rag/embed-header.js");
  return { readEmbedSchema: vi.fn(() => EMBED_SCHEMA) };
});

const { maybeAutoUpdate } = await import("../../src/rag/auto-update.js");
const { indexProjectDelta } = await import("../../src/rag/indexer.js");
const realIndexer = await vi.importActual("../../src/rag/indexer.js");
const { openVecStore, countChunks } = await import("../../src/rag/vec-store.js");

let root, dir;
const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" }).trim();
const commit = (name, body, msg) => {
  writeFileSync(join(dir, name), body);
  git("add", ".");
  git("commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
};
const warned = [];
const logger = { info: vi.fn(), warn: (l) => warned.push(l) };
const embedder = { embed: vi.fn(async () => { const v = new Float32Array(8); v[0] = 1; return v; }), dim: 8 };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-rag-worktree-"));
  dir = join(root, "proj");
  state.dbPath = join(root, "rag.db");
  mkdirSync(join(dir, "src"), { recursive: true });
  git("init", "-q", "-b", "main");
  state.since = commit("src/a.js", "export const a = 1;\n", "base");
  warned.length = 0;
  vi.clearAllMocks();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("indexProjectDelta over the working tree", () => {
  it("indexes a modified file and an untracked one; without the flag since === HEAD stays a no-op", async () => {
    const db = openVecStore({ dim: 8, path: join(root, "rag.db") });
    try {
      commit("src/b.js", "export const b = 1;\n", "second");
      const head = git("rev-parse", "HEAD");
      let t = await realIndexer.indexProjectDelta(dir, { db, embedder, since: state.since, logger, worktree: true });
      expect(t.files).toBe(1);
      const seeded = countChunks(db);
      writeFileSync(join(dir, "src", "b.js"), "export const b = 2;\nexport const bb = 3;\n");
      writeFileSync(join(dir, "src", "c.js"), "export const c = 1;\n");
      t = await realIndexer.indexProjectDelta(dir, { db, embedder, since: head, logger, worktree: true });
      expect(t.files).toBe(2);
      const dirtyCount = countChunks(db);
      expect(dirtyCount).toBeGreaterThan(seeded);
      // Reverted and deleted: git lists neither any more, the reconcile list brings them back in line.
      git("checkout", "--", "src/b.js");
      rmSync(join(dir, "src", "c.js"));
      t = await realIndexer.indexProjectDelta(dir, { db, embedder, since: head, logger, worktree: true, reconcile: ["src/b.js", "src/c.js"] });
      expect(t).toMatchObject({ files: 1, deleted: 1 });
      expect(countChunks(db)).toBe(seeded);
      expect(await realIndexer.indexProjectDelta(dir, { db, embedder, since: head, logger })).toMatchObject({ files: 0 });
      // A rename staged and not committed: the old source leaves the index, the new one enters.
      git("mv", "src/b.js", "src/d.js");
      t = await realIndexer.indexProjectDelta(dir, { db, embedder, since: head, logger, worktree: true });
      expect(t).toMatchObject({ files: 1, deleted: 1 });
      expect(countChunks(db)).toBe(seeded);
    } finally { db.close(); }
  });
});

describe("maybeAutoUpdate reconciles a tree that became clean", () => {
  it("a reverted file is reindexed once more, then the clean tree is a no-op again", async () => {
    writeFileSync(join(dir, "src", "a.js"), "export const a = 2;\n");
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ ran: true });
    git("checkout", "--", "src/a.js");
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ ran: true });
    expect(indexProjectDelta).toHaveBeenLastCalledWith(dir, expect.objectContaining({ reconcile: ["src/a.js"] }));
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ skipped: true });
  });
});

describe("maybeAutoUpdate covers the working tree", () => {
  it("a file changed and not committed is refreshed although HEAD is the indexed commit", async () => {
    writeFileSync(join(dir, "src", "a.js"), "export const a = 2;\n");
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ ran: true });
    expect(indexProjectDelta).toHaveBeenCalledWith(dir, expect.objectContaining({ since: state.since, worktree: true }));
  });

  it("an untracked file counts as drift; a clean tree on the indexed commit does not", async () => {
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ skipped: true });
    expect(indexProjectDelta).not.toHaveBeenCalled();
    writeFileSync(join(dir, "src", "new.js"), "export const n = 1;\n");
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ ran: true });
  });

  it("the bound counts committed and uncommitted changes together", async () => {
    commit("src/k.js", "export const k = 1;\n", "committed");
    writeFileSync(join(dir, "src", "w0.js"), "export const w0 = 1;\n");
    writeFileSync(join(dir, "src", "w1.js"), "export const w1 = 1;\n");
    const res = await maybeAutoUpdate({ projectDir: dir, config: { rag: { autoUpdate: { maxFiles: 2 } } }, logger });
    expect(res).toMatchObject({ skipped: true, reason: "drift-too-large", changed: 3 });
    expect(indexProjectDelta).not.toHaveBeenCalled();
  });

  it("an embedder that is down is said once per process, and the query goes on", async () => {
    indexProjectDelta.mockRejectedValue(new Error("ollama: connect ECONNREFUSED"));
    writeFileSync(join(dir, "src", "a.js"), "export const a = 3;\n");
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ failed: true });
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ failed: true });
    expect(warned.filter((l) => /auto-update failed/.test(l))).toHaveLength(1);
  });
});

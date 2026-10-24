// KJC-TSK-1171 (RAG-B): an index built before the embedded header is rebuilt once before it
// serves queries; too large to rebuild in-line, the query answers from it and kj says once
// how to rebuild. The drift check that follows is untouched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { schema: 1, sources: 3, since: null };
vi.mock("../../src/rag/project-store.js", () => ({
  openProjectStore: vi.fn(() => ({ close: vi.fn(), prepare: () => ({ get: () => ({ n: state.sources }) }) })),
}));
// KJC-TSK-1174: the tree is clean here and nothing carries over between tests; the working tree is tested apart.
vi.mock("../../src/rag/worktree-files.js", () => ({ untrackedFiles: vi.fn(async () => []), readRefreshedPaths: vi.fn(() => []), writeRefreshedPaths: vi.fn() }));
vi.mock("../../src/rag/vec-store.js", () => ({ projectSlug: vi.fn(() => "p"), getLastIndexedCommit: vi.fn(() => state.since), setLastIndexedCommit: vi.fn() }));
vi.mock("../../src/rag/indexer.js", () => ({
  indexProject: vi.fn(async () => ({ indexed: 9, files: 3, head: "h" })),
  indexProjectDelta: vi.fn(async () => ({ indexed: 1, files: 1, head: "h" })),
}));
vi.mock("../../src/rag/governed-embedder.js", () => ({ makeGovernedEmbedder: vi.fn(() => ({})) }));
vi.mock("../../src/rag/embed-schema.js", () => ({ readEmbedSchema: vi.fn(() => state.schema) }));

const { maybeAutoUpdate } = await import("../../src/rag/auto-update.js");
const { indexProject, indexProjectDelta } = await import("../../src/rag/indexer.js");

let dir;
const warned = [];
const logger = { info: vi.fn(), warn: (l) => warned.push(l) };
const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir, encoding: "utf8" }).trim();
const commit = (name) => { writeFileSync(join(dir, name), `export const ${name.replace(".js", "")} = 1;\n`); git("add", "."); git("commit", "-q", "-m", name); return git("rev-parse", "HEAD"); };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-rag-schema-"));
  git("init", "-q", "-b", "main");
  state.since = commit("a.js");
  commit("b.js"); // one file of drift, so the drift check has work when it runs
  warned.length = 0;
  vi.clearAllMocks();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("maybeAutoUpdate and the embed schema", () => {
  it("rebuilds a small index that predates the header, with the sources, before anything else", async () => {
    state.schema = 1; state.sources = 3;
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ ran: true, rebuilt: true });
    expect(indexProject).toHaveBeenCalledWith(dir, expect.objectContaining({ withSources: true }));
    expect(indexProjectDelta).not.toHaveBeenCalled();
  });

  it("a large old index is served as it is, and the rebuild is asked for once", async () => {
    state.schema = 1; state.sources = 400;
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ skipped: true, reason: "embed-schema-old", sources: 400 });
    await maybeAutoUpdate({ projectDir: dir, config: {}, logger });
    expect(warned.filter((l) => /predates the embedded header/.test(l))).toHaveLength(1);
    expect(warned[0]).toMatch(/kj rag index --with-sources/);
    expect(indexProject).not.toHaveBeenCalled();
  });

  it("an index on the current schema goes straight to the drift check", async () => {
    state.schema = 2; state.sources = 3;
    await maybeAutoUpdate({ projectDir: dir, config: {}, logger });
    expect(indexProject).not.toHaveBeenCalled();
    expect(indexProjectDelta).toHaveBeenCalledTimes(1);
  });
});

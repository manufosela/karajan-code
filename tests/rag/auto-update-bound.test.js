// KJC-BUG-0304: the delta-update before a query is bounded. A drift of hundreds of
// files (an index weeks old) made `kj rag query` reindex the repo for half an hour
// before answering, while the rag-first gate stayed shut.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { since: null };
vi.mock("../../src/rag/project-store.js", () => ({ openProjectStore: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock("../../src/rag/vec-store.js", () => ({ projectSlug: vi.fn(() => "p"), getLastIndexedCommit: vi.fn(() => state.since), setLastIndexedCommit: vi.fn() }));
vi.mock("../../src/rag/indexer.js", () => ({ indexProjectDelta: vi.fn(async () => ({ indexed: 1, files: 1, head: "h" })) }));
vi.mock("../../src/rag/governed-embedder.js", () => ({ makeGovernedEmbedder: vi.fn(() => ({})) }));

const { maybeAutoUpdate } = await import("../../src/rag/auto-update.js");
const { indexProjectDelta } = await import("../../src/rag/indexer.js");

let dir;
const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir, encoding: "utf8" }).trim();
const commitFiles = (n, tag) => {
  for (let i = 0; i < n; i += 1) writeFileSync(join(dir, `${tag}-${i}.js`), `export const x${i} = ${i};\n`);
  git("add", ".");
  git("commit", "-q", "-m", tag);
  return git("rev-parse", "HEAD");
};
const warned = [];
const logger = { info: vi.fn(), warn: (l) => warned.push(l) };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-rag-bound-"));
  git("init", "-q", "-b", "main");
  state.since = commitFiles(1, "base");
  warned.length = 0;
  vi.clearAllMocks();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("maybeAutoUpdate bound", () => {
  it("a small drift is refreshed before the query, as before", async () => {
    commitFiles(3, "small");
    expect(await maybeAutoUpdate({ projectDir: dir, config: {}, logger })).toMatchObject({ ran: true });
    expect(indexProjectDelta).toHaveBeenCalledTimes(1);
  });

  it("a large drift does not block the query: it answers from the index and says how to refresh", async () => {
    commitFiles(30, "big");
    const res = await maybeAutoUpdate({ projectDir: dir, config: {}, logger });
    expect(res).toMatchObject({ skipped: true, reason: "drift-too-large", changed: 30 });
    expect(indexProjectDelta).not.toHaveBeenCalled();
    expect(warned[0]).toMatch(/30 file\(s\) changed since the last index .*kj rag index --since auto/);
  });

  it("the bound is configurable", async () => {
    commitFiles(30, "big");
    expect(await maybeAutoUpdate({ projectDir: dir, config: { rag: { autoUpdate: { maxFiles: 50 } } }, logger })).toMatchObject({ ran: true });
  });
});

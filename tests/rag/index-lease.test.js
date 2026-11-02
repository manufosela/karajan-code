// HU-2907: a foreground `kj rag index` holds the machine index lease for its full walk only, so
// background lanes defer to it, and it never takes another live indexer's claim.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/rag/project-store.js", () => ({ openProjectStore: vi.fn(() => ({ close: vi.fn() })), openLibraryStore: vi.fn(() => ({ close: vi.fn() })), projectDbPath: vi.fn() }));
vi.mock("../../src/rag/vec-store.js", async () => ({ ...(await vi.importActual("../../src/rag/vec-store.js")), projectSlug: vi.fn(() => "p"), getLastIndexedCommit: vi.fn(() => null), setLastIndexedCommit: vi.fn(), deleteChunksBySource: vi.fn(() => 0) }));
vi.mock("../../src/rag/indexer.js", () => ({ indexProject: vi.fn(), indexProjectDelta: vi.fn(), indexFile: vi.fn(), sourceKind: vi.fn() }));
vi.mock("../../src/rag/governed-embedder.js", () => ({ makeGovernedEmbedder: vi.fn(() => ({})) }));
vi.mock("../../src/rag/library.js", () => ({ indexLibrary: vi.fn(), LIBRARY_PROJECT: "library" }));
const { ragIndexCommand } = await import("../../src/commands/rag.js");
const { indexProject, indexProjectDelta } = await import("../../src/rag/indexer.js");
const { indexLeasePath, readLease, writeLease } = await import("../../src/rag/pid-lease.js");
const totals = { indexed: 1, failed: 0, files: 1, deleted: 0 };
const { openProjectStore, projectDbPath } = await import("../../src/rag/project-store.js");
const { makeGovernedEmbedder } = await import("../../src/rag/governed-embedder.js");
const { setLastIndexedCommit } = await import("../../src/rag/vec-store.js");
const { indexLibrary } = await import("../../src/rag/library.js");
let root, prevHome, prevDeadline, lease, warned;
const logger = { info: vi.fn(), warn: (line) => warned.push(line) };
const run = (flags) => ragIndexCommand({ config: { projectDir: root }, logger, flags });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-index-lease-"));
  prevHome = process.env.KARAJAN_HOME;
  prevDeadline = process.env.KJ_RAG_DEADLINE;
  delete process.env.KJ_RAG_DEADLINE;
  process.env.KARAJAN_HOME = root;
  lease = indexLeasePath();
  warned = [];
  vi.clearAllMocks();
  indexProject.mockResolvedValue(totals);
  indexProjectDelta.mockResolvedValue(totals);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
  if (prevDeadline === undefined) delete process.env.KJ_RAG_DEADLINE; else process.env.KJ_RAG_DEADLINE = prevDeadline;
});
describe("ragIndexCommand machine lease", () => {
  it("a free lease names this pid and project during the full walk, and is gone after", async () => {
    let during;
    indexProject.mockImplementation(async () => { during = readLease(lease); return totals; });
    await run({});
    expect(during).toMatchObject({ pid: process.pid, slug: "p", running: true });
    expect(readLease(lease)).toBeNull();
  });
  it("a lease held by another live pid warns once, indexes anyway and leaves the lease untouched", async () => {
    const other = spawn("sleep", ["30"]); // a live pid that is neither this process nor its parent
    try {
      writeLease(lease, { pid: other.pid, at: Date.now(), slug: "other" });
      const before = readFileSync(lease, "utf8");
      await run({});
      expect(warned).toEqual([`[rag] another index is running (other, pid ${other.pid}); indexing anyway`]);
      expect(readFileSync(lease, "utf8")).toBe(before);
    } finally { other.kill(); }
    expect(indexProject).toHaveBeenCalledTimes(1);
  });
  it("a run that throws propagates the error and still releases the lease", async () => {
    indexProject.mockRejectedValue(new Error("boom"));
    await expect(run({})).rejects.toThrow("boom");
    expect(readLease(lease)).toBeNull();
  });
  it.each([["its own pid", process.pid], ["its spawning parent", process.ppid]])("the bootstrap child finds the lease naming %s: no warning, and it releases it", async (_who, pid) => {
    writeLease(lease, { pid, at: Date.now(), slug: "p" });
    await run({});
    expect(warned).toEqual([]);
    expect(readLease(lease)).toBeNull();
  });
});

// HU-3092: a background indexer stops itself at its deadline and leaves a partial index unmarked.
describe("ragIndexCommand deadline", () => {
  const marker = () => `${root}/rag.db.bootstrap`;
  beforeEach(() => { projectDbPath.mockReturnValue(`${root}/rag.db`); });
  it("a deadline already past returns at once: no store, no embedder, no indexing; the marker naming this pid is noted", async () => {
    writeLease(marker(), { pid: process.pid, at: Date.now(), command: "c" });
    process.env.KJ_RAG_DEADLINE = "1";
    expect(await run({ withSources: true })).toEqual({ indexed: 0, failed: 0, files: 0, stopped: "deadline" });
    expect(indexProject).not.toHaveBeenCalled();
    expect(openProjectStore).not.toHaveBeenCalled();
    expect(makeGovernedEmbedder).not.toHaveBeenCalled();
    expect(readLease(marker())).toMatchObject({ stoppedBy: "deadline", running: false });
  });
  it("a marker naming another pid is left untouched", async () => {
    writeLease(marker(), { pid: process.ppid, at: Date.now(), command: "c" });
    process.env.KJ_RAG_DEADLINE = "1";
    await run({});
    expect(readLease(marker()).stoppedBy).toBeUndefined();
  });
  it.each(["", "abc", "0", "-5"])("KJ_RAG_DEADLINE=%j means no deadline", async (v) => {
    process.env.KJ_RAG_DEADLINE = v;
    await run({});
    expect(indexProject).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deadline: null }));
  });
  it("a stopped index keeps no commit, skips the library, releases the lease, notes the marker and warns", async () => {
    writeLease(marker(), { pid: process.pid, at: Date.now(), command: "c" });
    process.env.KJ_RAG_DEADLINE = String(Date.now() + 60_000);
    indexProject.mockResolvedValue({ indexed: 3, failed: 0, files: 2, head: "abc", stopped: "deadline" });
    expect((await run({ withSources: true })).stopped).toBe("deadline");
    expect(setLastIndexedCommit).not.toHaveBeenCalled();
    expect(indexLibrary).not.toHaveBeenCalled();
    expect(readLease(lease)).toBeNull();
    expect(readLease(marker())).toMatchObject({ stoppedBy: "deadline" });
    expect(warned).toEqual([expect.stringMatching(/KJ_RAG_DEADLINE reached after 2 file\(s\).*partial.*not recorded/)]);
  });
});

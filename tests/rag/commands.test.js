// KJC-PCS-0049 Step 6 — kj rag command acceptance pins.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("../../src/rag/embedder.js", () => {
  class FakeEmbedder {
    constructor() { this.dim = 8; }
    async embed() { const v = new Float32Array(8); v[0] = 1; return v; }
    async embedBatch(ts) { return ts.map(() => { const v = new Float32Array(8); v[0] = 1; return v; }); }
  }
  return { OllamaEmbedder: FakeEmbedder, OllamaEmbedderError: class extends Error {} };
});

describe("kj rag commands — KJC-PCS-0049 Step 6", () => {
  let root, prevHome, prevDb;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-rag-cmd-"));
    prevHome = process.env.KARAJAN_HOME;
    prevDb = process.env.KJ_RAG_DB;
    process.env.KARAJAN_HOME = join(root, ".karajan");
    process.env.KJ_RAG_DB = join(root, "rag.db");
    mkdirSync(process.env.KARAJAN_HOME, { recursive: true });
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
    if (prevDb === undefined) delete process.env.KJ_RAG_DB; else process.env.KJ_RAG_DB = prevDb;
  });

  it("ragIndexCommand reports totals from indexProject", async () => {
    const { ragIndexCommand } = await import("../../src/commands/rag.js");
    const slug = "myp";
    const projectDir = join(root, slug);
    mkdirSync(projectDir);
    mkdirSync(join(process.env.KARAJAN_HOME, "plans", slug), { recursive: true });
    writeFileSync(
      join(process.env.KARAJAN_HOME, "plans", slug, "plan-001.json"),
      JSON.stringify({ hus: [{ id: "A", title: "alpha", description: "do A" }] })
    );
    const totals = await ragIndexCommand({ config: { projectDir, rag: { embedder: { dim: 8 } } }, logger: noopLogger, flags: {} });
    expect(totals.files).toBeGreaterThan(0);
    expect(totals.indexed).toBeGreaterThan(0);
  });

  it("ragQueryCommand on an empty store warns and returns []", async () => {
    const { ragQueryCommand } = await import("../../src/commands/rag.js");
    const hits = await ragQueryCommand({ text: "anything", config: { rag: { embedder: { dim: 8 } } }, logger: noopLogger, flags: {} });
    expect(hits).toEqual([]);
    expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/No chunks indexed/));
  });

  it("ragQueryCommand returns hits after indexing", async () => {
    const { ragIndexCommand, ragQueryCommand } = await import("../../src/commands/rag.js");
    const slug = "p2";
    const projectDir = join(root, slug);
    mkdirSync(projectDir);
    mkdirSync(join(process.env.KARAJAN_HOME, "plans", slug), { recursive: true });
    writeFileSync(
      join(process.env.KARAJAN_HOME, "plans", slug, "plan-001.json"),
      JSON.stringify({ hus: [{ id: "A", title: "alpha auth", description: "do A" }] })
    );
    await ragIndexCommand({ config: { projectDir, rag: { embedder: { dim: 8 } } }, logger: noopLogger, flags: {} });
    const hits = await ragQueryCommand({ text: "auth", config: { projectDir, rag: { embedder: { dim: 8 } } }, logger: noopLogger, flags: { topK: 3 } });
    expect(hits.length).toBeGreaterThan(0);
  });
});

// KJC-PCS-0049 Step 6 — kj rag command acceptance pins.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// KJC-TSK-0632: the embedder moved to karajan-core/rag — mock the REAL
// module (the src/rag path is now a re-export shim the consumers bypass).
vi.mock("karajan-core/rag/embedder", () => {
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

  // KJC-BUG-0061 follow-up: CLI `--json` on empty store must emit the
  // same `{ hits, empty, topK, scope }` shape as the MCP handler so the
  // `/kj-rag-query` skill from Camino B has a deterministic recovery
  // signal. Previously it emitted just `[]`, indistinguishable from a
  // populated store returning zero hits.
  it("ragQueryCommand --json on empty store emits {hits:[], empty:true, topK, scope}", async () => {
    const { ragQueryCommand } = await import("../../src/commands/rag.js");
    const chunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { chunks.push(String(s)); return true; };
    try {
      await ragQueryCommand({ text: "x", config: { rag: { embedder: { dim: 8 } } }, logger: noopLogger, flags: { json: true, topK: 7, scope: "plans" } });
    } finally {
      process.stdout.write = origWrite;
    }
    const out = JSON.parse(chunks.join("").trim());
    expect(out).toEqual({ hits: [], empty: true, topK: 7, scope: "plans" });
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

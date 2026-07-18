// KJC-PCS-0049 Step 7 — MCP rag handlers acceptance pins.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("karajan-core/rag/embedder", () => {
  class FakeEmbedder {
    constructor() { this.dim = 8; }
    async embed() { const v = new Float32Array(8); v[0] = 1; return v; }
    async embedBatch(ts) { return ts.map(() => { const v = new Float32Array(8); v[0] = 1; return v; }); }
  }
  return { OllamaEmbedder: FakeEmbedder, OllamaEmbedderError: class extends Error {} };
});

vi.mock("../../src/mcp/shared-helpers.js", async () => {
  const actual = await vi.importActual("../../src/mcp/shared-helpers.js");
  return {
    ...actual,
    resolveProjectDir: vi.fn(async (_s, dir) => dir || process.cwd()),
    buildConfig: vi.fn(async (args) => ({
      projectDir: args.projectDir || process.cwd(),
      rag: { embedder: { dim: 8 } },
    })),
  };
});

describe("MCP rag handlers — KJC-PCS-0049 Step 7", () => {
  let root, prevHome, prevDb;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-mcp-rag-"));
    prevHome = process.env.KARAJAN_HOME;
    prevDb = process.env.KJ_RAG_DB;
    process.env.KARAJAN_HOME = join(root, ".karajan");
    process.env.KJ_RAG_DB = join(root, "rag.db");
    mkdirSync(process.env.KARAJAN_HOME, { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
    if (prevDb === undefined) delete process.env.KJ_RAG_DB; else process.env.KJ_RAG_DB = prevDb;
  });

  it("kj_rag_query rejects empty text without touching the store", async () => {
    const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");
    const res = await handleRagQuery({ text: "" }, {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/required and must be a non-empty string/);
  });

  it("kj_rag_query on an empty store responds with empty=true and hits=[]", async () => {
    const projectDir = join(root, "myp");
    mkdirSync(projectDir);
    const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");
    const res = await handleRagQuery({ text: "anything", projectDir }, {});
    const payload = JSON.parse(res.content[0].text);
    expect(payload.empty).toBe(true);
    expect(payload.hits).toEqual([]);
    expect(payload.topK).toBe(5);
    expect(payload.scope).toBe("all");
  });

  it("kj_rag_index returns totals from indexProject", async () => {
    const slug = "p2";
    const projectDir = join(root, slug);
    mkdirSync(projectDir);
    mkdirSync(join(process.env.KARAJAN_HOME, "plans", slug), { recursive: true });
    writeFileSync(
      join(process.env.KARAJAN_HOME, "plans", slug, "plan-001.json"),
      JSON.stringify({ hus: [{ id: "A", title: "alpha", description: "do A" }] })
    );
    const { handleRagIndex } = await import("../../src/mcp/handlers/rag-handler.js");
    const res = await handleRagIndex({ projectDir }, {});
    const payload = JSON.parse(res.content[0].text);
    expect(payload.files).toBeGreaterThan(0);
    expect(payload.indexed).toBeGreaterThan(0);
  });
});

// KJC-PCS-0049 Step 7 — MCP rag handlers acceptance pins.
import { mkdtempSync,mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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

// The index kj_rag_index starts in the background, walked here in the foreground so the queries have one.
async function seedIndex(projectDir) {
  const { openProjectStore } = await import("../../src/rag/project-store.js");
  const { indexProject } = await import("../../src/rag/indexer.js");
  const { makeGovernedEmbedder } = await import("../../src/rag/governed-embedder.js");
  const db = openProjectStore({ projectDir, dim: 8 });
  const embedder = makeGovernedEmbedder({ projectDir, rag: { embedder: { dim: 8 } } });
  try { await indexProject(projectDir, { db, embedder, karajanHome: process.env.KARAJAN_HOME, logger: { info() {}, warn() {} } }); } finally { db.close(); }
}

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

  // KJC-BUG-0177 (#1713): the store is shared across projects; the MCP
  // tool must scope to the caller's project like the CLI does.
  describe("kj_rag_query project isolation", () => {
    const indexPlan = async (slug) => {
      const projectDir = join(root, slug);
      mkdirSync(projectDir);
      mkdirSync(join(process.env.KARAJAN_HOME, "plans", slug), { recursive: true });
      writeFileSync(
        join(process.env.KARAJAN_HOME, "plans", slug, "plan-001.json"),
        JSON.stringify({ hus: [{ id: `${slug}-A`, title: `alpha ${slug}`, description: `do alpha in ${slug}` }] })
      );
      await seedIndex(projectDir);
      return projectDir;
    };

    it("defaults to the slug of projectDir, honours an explicit slug and 'all'", async () => {
      const mine = await indexPlan("mine");
      await indexPlan("other");
      const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");

      const scoped = JSON.parse((await handleRagQuery({ text: "alpha", projectDir: mine }, {})).content[0].text);
      expect(scoped.project).toBe("mine");
      expect(scoped.hits.length).toBeGreaterThan(0);
      expect(scoped.hits.every((h) => h.project_slug === "mine")).toBe(true);

      const explicit = JSON.parse((await handleRagQuery({ text: "alpha", projectDir: mine, project: "other" }, {})).content[0].text);
      expect(explicit.hits.length).toBeGreaterThan(0);
      expect(explicit.hits.every((h) => h.project_slug === "other")).toBe(true);

      const all = JSON.parse((await handleRagQuery({ text: "alpha", projectDir: mine, project: "all" }, {})).content[0].text);
      expect(all.project).toBeNull();
      expect(new Set(all.hits.map((h) => h.project_slug))).toEqual(new Set(["mine", "other"]));
    });

    it("leaves the answer note a kj project's stage and Sentinel read, as the CLI does (KJC-TSK-1438)", async () => {
      const mine = await indexPlan("noted");
      mkdirSync(join(mine, ".karajan"));
      const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");
      await handleRagQuery({ text: "alpha", projectDir: mine }, {});
      const note = JSON.parse(readFileSync(join(mine, ".karajan", "harness", "rag-answer.json"), "utf8"));
      expect(note.text).toBe("alpha");
      expect(note.sources.length).toBeGreaterThan(0);
    });
  });

  // KJC-BUG-0610: a large repo ran past the host's tool timeout. The index runs in the background
  // (the bootstrap's marker and machine lease) and the tool answers at once, then with its progress.
  describe("kj_rag_index in the background", () => {
    let projectDir, handleRagIndex, started;
    const start = (dir, opts) => { started.push({ dir, opts }); return { started: true, pid: 123 }; };
    const payloadOf = (res) => JSON.parse(res.content[0].text);
    beforeEach(async () => {
      ({ handleRagIndex } = await import("../../src/mcp/handlers/rag-handler.js"));
      projectDir = join(root, "bg");
      mkdirSync(projectDir);
      started = [];
    });
    it("starts it, asked by hand, with withSources and force, and answers at once with the last totals", async () => {
      const read = () => ({ running: false, totals: { indexed: 4, files: 2 } });
      const res = await handleRagIndex({ projectDir, withSources: true, force: true }, {}, { start, read });
      expect(started).toEqual([{ dir: projectDir, opts: { indexArgs: ["--with-sources", "--force"], explicit: true, force: true } }]);
      expect(payloadOf(res)).toMatchObject({ started: true, pid: 123, last: { indexed: 4, files: 2 } });
      expect(payloadOf(res).next).toMatch(/kj_rag_index again.*progress/);
    });
    it("while it runs, answers with its progress and starts nothing", async () => {
      const read = () => ({ running: true, pid: 9, progress: { done: 3, total: 10 } });
      const res = await handleRagIndex({ projectDir }, {}, { start, read });
      expect(started).toEqual([]);
      expect(payloadOf(res)).toMatchObject({ running: true, pid: 9, progress: { done: 3, total: 10 } });
    });
    it("yields to another project's live indexer without force, naming it and force", async () => {
      const busy = () => ({ started: false, busy: { slug: "other", pid: 77 } });
      const res = await handleRagIndex({ projectDir }, {}, { start: busy, read: () => null });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/other, pid 77.*force: true/);
    });
  });

  // KJC-TSK-0883 (ADR 0011): el MCP lee el indice del PROYECTO, como la CLI
  // desde 0882; si no, dos clientes del mismo repo veian indices distintos.
  it("kj_rag_query reads <projectDir>/.karajan/rag.db, and an empty one names its remedy", async () => {
    delete process.env.KJ_RAG_DB;
    const a = join(root, "a");
    const b = join(root, "b");
    mkdirSync(join(process.env.KARAJAN_HOME, "plans", "a"), { recursive: true });
    writeFileSync(join(process.env.KARAJAN_HOME, "plans", "a", "plan-001.json"), JSON.stringify({ hus: [{ id: "A", title: "alpha", description: "do A" }] }));
    mkdirSync(a); mkdirSync(b);
    const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");
    await seedIndex(a);
    const { openVecStore, countChunks } = await import("../../src/rag/vec-store.js");
    const db = openVecStore({ dim: 8, path: join(a, ".karajan", "rag.db") });
    try { expect(countChunks(db)).toBeGreaterThan(0); } finally { db.close(); }

    const hitsA = JSON.parse((await handleRagQuery({ text: "alpha", projectDir: a }, {})).content[0].text);
    expect(hitsA.hits.length).toBeGreaterThan(0);
    const emptyB = JSON.parse((await handleRagQuery({ text: "alpha", projectDir: b }, {})).content[0].text);
    expect(emptyB).toMatchObject({ empty: true, hits: [], remedy: "kj rag index --with-sources" });
  });
});

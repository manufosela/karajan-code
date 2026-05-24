// KJC-PCS-0049 Camino C — pre-loop RAG retrieval stage acceptance pins.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/rag/embedder.js", () => {
  class FakeEmbedder {
    constructor() { this.dim = 768; }
    async embed() { const v = new Float32Array(768); v[0] = 1; return v; }
  }
  return { OllamaEmbedder: FakeEmbedder, OllamaEmbedderError: class extends Error {} };
});

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const noopEmitter = { emit: vi.fn() };

describe("rag-context-stage — KJC-PCS-0049 Camino C", () => {
  let root, prevDb;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-rag-preload-"));
    prevDb = process.env.KJ_RAG_DB;
    process.env.KJ_RAG_DB = join(root, "rag.db");
    noopLogger.info.mockClear(); noopLogger.warn.mockClear();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (prevDb === undefined) delete process.env.KJ_RAG_DB; else process.env.KJ_RAG_DB = prevDb;
  });

  it("skips when config.rag.preload.enabled is missing or false", async () => {
    const { runRagContextStage } = await import("../../src/orchestrator/stages/rag-context-stage.js");
    const r1 = await runRagContextStage({ config: {}, logger: noopLogger, emitter: noopEmitter, task: "hi" });
    expect(r1.skipped).toBe(true);
    expect(r1.reason).toBe("disabled");
    const r2 = await runRagContextStage({ config: { rag: { preload: { enabled: false } } }, logger: noopLogger, emitter: noopEmitter, task: "hi" });
    expect(r2.skipped).toBe(true);
  });

  it("skips with reason='empty' on a fresh vec store", async () => {
    mkdirSync(root, { recursive: true });
    const { runRagContextStage } = await import("../../src/orchestrator/stages/rag-context-stage.js");
    const r = await runRagContextStage({
      config: { rag: { preload: { enabled: true }, embedder: { dim: 768 } } },
      logger: noopLogger, emitter: noopEmitter, task: "anything",
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("empty");
    expect(noopLogger.info).toHaveBeenCalled();
  });

  it("returns contextBlock with prior context when chunks exist", async () => {
    const { openVecStore, insertChunk } = await import("../../src/rag/vec-store.js");
    const db = openVecStore({ dim: 768 });
    const v = new Float32Array(768); v[0] = 1;
    insertChunk(db, { source: "/p", kind: "plan", text: "Previously: auth used JWT.", metadata: { hu_id: "AUTH-1" }, embedding: v });
    db.close();
    const { runRagContextStage } = await import("../../src/orchestrator/stages/rag-context-stage.js");
    const r = await runRagContextStage({
      config: { rag: { preload: { enabled: true, topK: 3 }, embedder: { dim: 768 } } },
      logger: noopLogger, emitter: noopEmitter, task: "implement auth",
    });
    expect(r.skipped).toBe(false);
    expect(r.contextBlock).toContain("Prior context from RAG");
    expect(r.contextBlock).toContain("AUTH-1");
    expect(r.contextBlock).toContain("Previously: auth used JWT.");
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("returns skipped + reason on missing task", async () => {
    const { runRagContextStage } = await import("../../src/orchestrator/stages/rag-context-stage.js");
    const r = await runRagContextStage({
      config: { rag: { preload: { enabled: true } } },
      logger: noopLogger, emitter: noopEmitter, task: "",
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("no-task");
  });
});

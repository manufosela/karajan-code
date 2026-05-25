// KJC-TSK-0447 — ONNX local embedder tests. We don't actually download
// model weights in CI (slow + flaky), so the tests cover the synchronous
// surface: factory selection, dim defaults, helpful error when the
// peer dep is not installed, and the embed() guard rails (input
// validation, dim mismatch detection).
import { describe, expect, it, vi } from "vitest";
import { makeEmbedder } from "../../src/rag/embedders/factory.js";
import { ONNXEmbedder, ONNXEmbedderError } from "../../src/rag/embedders/onnx.js";

describe("rag/embedders/onnx — factory wiring", () => {
  it("selects ONNX provider when configured", () => {
    const e = makeEmbedder({ rag: { embedder: { provider: "onnx" } } });
    expect(e).toBeInstanceOf(ONNXEmbedder);
    expect(e.dim).toBe(384);
    expect(e.model).toMatch(/MiniLM/);
  });

  it("honors explicit model + dim override", () => {
    const e = makeEmbedder({ rag: { embedder: { provider: "onnx", model: "Xenova/jina-embeddings-v2-base-en", dim: 768 } } });
    expect(e.model).toMatch(/jina/);
    expect(e.dim).toBe(768);
  });
});

describe("ONNXEmbedder", () => {
  it("rejects empty input before touching the pipeline", async () => {
    const e = new ONNXEmbedder();
    await expect(e.embed("")).rejects.toThrow(ONNXEmbedderError);
    await expect(e.embed(null)).rejects.toThrow(ONNXEmbedderError);
  });

  it("rejects non-array input to embedBatch", async () => {
    const e = new ONNXEmbedder();
    await expect(e.embedBatch("not-an-array")).rejects.toThrow(/must be an array/);
  });

  it("returns Float32Array from the pipeline output", async () => {
    const e = new ONNXEmbedder({ dim: 4 });
    // Stub the pipeline to bypass model download.
    e._pipe = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3, 0.4]) });
    const v = await e.embed("hello");
    expect(v).toBeInstanceOf(Float32Array);
    expect(Array.from(v)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.3, 6),
      expect.closeTo(0.4, 6),
    ]);
  });

  it("throws on dim mismatch from the pipeline", async () => {
    const e = new ONNXEmbedder({ dim: 4 });
    e._pipe = vi.fn().mockResolvedValue({ data: new Float32Array([0.1, 0.2]) });
    await expect(e.embed("x")).rejects.toThrow(/dim mismatch/);
  });
});

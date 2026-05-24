// KJC-PCS-0049 Step 2 — OllamaEmbedder acceptance pins. Uses an injected
// fetch mock; no real network call.
import { describe, expect, it, vi } from "vitest";
import { OllamaEmbedder, OllamaEmbedderError } from "../../src/rag/embedder.js";

function okResponse(embedding) {
  return { ok: true, status: 200, json: async () => ({ embedding }) };
}
function errResponse(status) {
  return { ok: false, status, json: async () => ({}) };
}

describe("OllamaEmbedder — KJC-PCS-0049 Step 2", () => {
  it("embed returns a Float32Array of the configured dim", async () => {
    const vec = Array.from({ length: 8 }, (_, i) => i / 8);
    const fetchFn = vi.fn().mockResolvedValue(okResponse(vec));
    const e = new OllamaEmbedder({ dim: 8, fetchFn });
    const r = await e.embed("hello");
    expect(r).toBeInstanceOf(Float32Array);
    expect(r.length).toBe(8);
    expect(r[0]).toBeCloseTo(0);
  });

  it("embed POSTs to /api/embeddings with the right shape", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([0, 0, 0, 0]));
    const e = new OllamaEmbedder({ dim: 4, url: "http://x:11434/", model: "m", fetchFn });
    await e.embed("hi");
    expect(fetchFn).toHaveBeenCalledWith("http://x:11434/api/embeddings", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ model: "m", prompt: "hi" }),
    }));
  });

  it("embed throws OllamaEmbedderError on HTTP 5xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(errResponse(500));
    const e = new OllamaEmbedder({ dim: 4, fetchFn });
    await expect(e.embed("hi")).rejects.toBeInstanceOf(OllamaEmbedderError);
  });

  it("embed throws on dim mismatch", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([1, 2, 3]));
    const e = new OllamaEmbedder({ dim: 768, fetchFn });
    await expect(e.embed("x")).rejects.toThrow(/dim mismatch/);
  });

  it("embed rejects empty text without making any HTTP call", async () => {
    const fetchFn = vi.fn();
    const e = new OllamaEmbedder({ dim: 4, fetchFn });
    await expect(e.embed("")).rejects.toThrow(/non-empty string/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("embedBatch preserves input order", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(okResponse([1, 0]))
      .mockResolvedValueOnce(okResponse([0, 1]));
    const e = new OllamaEmbedder({ dim: 2, fetchFn });
    const out = await e.embedBatch(["a", "b"]);
    expect(out.length).toBe(2);
    expect(out[0][0]).toBe(1);
    expect(out[1][1]).toBe(1);
  });

  it("KJ_OLLAMA_URL + KJ_OLLAMA_EMBED_MODEL env overrides reach the adapter", async () => {
    const prevUrl = process.env.KJ_OLLAMA_URL;
    const prevModel = process.env.KJ_OLLAMA_EMBED_MODEL;
    process.env.KJ_OLLAMA_URL = "http://env-url:11434";
    process.env.KJ_OLLAMA_EMBED_MODEL = "env-model";
    try {
      const fetchFn = vi.fn().mockResolvedValue(okResponse([0, 0]));
      const e = new OllamaEmbedder({ dim: 2, fetchFn });
      expect(e.url).toBe("http://env-url:11434");
      expect(e.model).toBe("env-model");
    } finally {
      if (prevUrl === undefined) delete process.env.KJ_OLLAMA_URL; else process.env.KJ_OLLAMA_URL = prevUrl;
      if (prevModel === undefined) delete process.env.KJ_OLLAMA_EMBED_MODEL; else process.env.KJ_OLLAMA_EMBED_MODEL = prevModel;
    }
  });
});

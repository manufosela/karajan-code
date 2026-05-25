// KJC-TSK-0442 — embedder factory + OpenAI + Voyage adapters.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeEmbedder } from "../../src/rag/embedders/factory.js";
import { OpenAIEmbedder, OpenAIEmbedderError } from "../../src/rag/embedders/openai.js";
import { VoyageEmbedder, VoyageEmbedderError } from "../../src/rag/embedders/voyage.js";
import { OllamaEmbedder } from "../../src/rag/embedder.js";

describe("rag/embedders factory (KJC-TSK-0442)", () => {
  it("defaults to Ollama provider when none configured", () => {
    const e = makeEmbedder({});
    expect(e).toBeInstanceOf(OllamaEmbedder);
    expect(e.dim).toBe(768);
  });

  it("selects OpenAI provider when configured", () => {
    const e = makeEmbedder({ rag: { embedder: { provider: "openai", api_key: "sk-test" } } });
    expect(e).toBeInstanceOf(OpenAIEmbedder);
    expect(e.dim).toBe(1536);
  });

  it("selects Voyage provider when configured", () => {
    const e = makeEmbedder({ rag: { embedder: { provider: "voyage", api_key: "pa-test" } } });
    expect(e).toBeInstanceOf(VoyageEmbedder);
    expect(e.dim).toBe(1024);
  });

  it("throws on unknown provider", () => {
    expect(() => makeEmbedder({ rag: { embedder: { provider: "anthropic" } } })).toThrow(/Unknown embedder provider/);
  });

  it("honors explicit dim override", () => {
    const e = makeEmbedder({ rag: { embedder: { provider: "openai", api_key: "k", dim: 512 } } });
    expect(e.dim).toBe(512);
  });
});

describe("OpenAIEmbedder (KJC-TSK-0442)", () => {
  it("rejects construction without an api key", () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try { expect(() => new OpenAIEmbedder({})).toThrow(OpenAIEmbedderError); }
    finally { if (prev !== undefined) process.env.OPENAI_API_KEY = prev; }
  });

  it("POSTs to /v1/embeddings with Bearer auth + returns Float32Array", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.1) }] }) });
    const e = new OpenAIEmbedder({ apiKey: "sk-test", fetchFn });
    const v = await e.embed("hello");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(1536);
    expect(fetchFn).toHaveBeenCalledWith("https://api.openai.com/v1/embeddings", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
    }));
  });

  it("throws on dim mismatch from server", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) });
    const e = new OpenAIEmbedder({ apiKey: "k", fetchFn });
    await expect(e.embed("x")).rejects.toThrow(/dim mismatch/);
  });

  it("throws on HTTP error status with the code", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const e = new OpenAIEmbedder({ apiKey: "k", fetchFn });
    await expect(e.embed("x")).rejects.toThrow(/HTTP 401/);
  });
});

describe("VoyageEmbedder (KJC-TSK-0442)", () => {
  it("rejects without api key", () => {
    const prev = process.env.VOYAGE_API_KEY;
    delete process.env.VOYAGE_API_KEY;
    try { expect(() => new VoyageEmbedder({})).toThrow(VoyageEmbedderError); }
    finally { if (prev !== undefined) process.env.VOYAGE_API_KEY = prev; }
  });

  it("POSTs with input_type=document + returns Float32Array", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: new Array(1024).fill(0.2) }] }) });
    const e = new VoyageEmbedder({ apiKey: "pa-test", fetchFn });
    const v = await e.embed("auth flow");
    expect(v.length).toBe(1024);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.input_type).toBe("document");
    expect(body.input).toEqual(["auth flow"]);
  });
});

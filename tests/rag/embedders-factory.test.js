// KJC-TSK-0442 — embedder factory + OpenAI + Voyage adapters.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeEmbedder } from "../../src/rag/embedders/factory.js";
import { OpenAIEmbedder, OpenAIEmbedderError } from "../../src/rag/embedders/openai.js";
import { VoyageEmbedder, VoyageEmbedderError } from "../../src/rag/embedders/voyage.js";
import { CohereEmbedder, CohereEmbedderError } from "../../src/rag/embedders/cohere.js";
import { MistralEmbedder, MistralEmbedderError } from "../../src/rag/embedders/mistral.js";
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

  it("selects Cohere provider when configured", () => {
    const e = makeEmbedder({ rag: { embedder: { provider: "cohere", api_key: "co-test" } } });
    expect(e).toBeInstanceOf(CohereEmbedder);
    expect(e.dim).toBe(1024);
  });

  it("selects Mistral provider when configured", () => {
    const e = makeEmbedder({ rag: { embedder: { provider: "mistral", api_key: "ms-test" } } });
    expect(e).toBeInstanceOf(MistralEmbedder);
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
    const prev = process.env.KJ_OPENAI_KEY;
    delete process.env.KJ_OPENAI_KEY;
    try { expect(() => new OpenAIEmbedder({})).toThrow(OpenAIEmbedderError); }
    finally { if (prev !== undefined) process.env.KJ_OPENAI_KEY = prev; }
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
    const prev = process.env.KJ_VOYAGE_KEY;
    delete process.env.KJ_VOYAGE_KEY;
    try { expect(() => new VoyageEmbedder({})).toThrow(VoyageEmbedderError); }
    finally { if (prev !== undefined) process.env.KJ_VOYAGE_KEY = prev; }
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

describe("CohereEmbedder (KJC-TSK-0446)", () => {
  it("rejects without api key", () => {
    const prev = process.env.KJ_COHERE_KEY;
    delete process.env.KJ_COHERE_KEY;
    try { expect(() => new CohereEmbedder({})).toThrow(CohereEmbedderError); }
    finally { if (prev !== undefined) process.env.KJ_COHERE_KEY = prev; }
  });

  it("POSTs with embedding_types=float + extracts embeddings.float[0]", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: { float: [new Array(1024).fill(0.3)] } }) });
    const e = new CohereEmbedder({ apiKey: "co-test", fetchFn });
    const v = await e.embed("login flow");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(1024);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.embedding_types).toEqual(["float"]);
    expect(body.input_type).toBe("search_document");
  });

  it("falls back to legacy embeddings[0] shape", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [new Array(1024).fill(0.4)] }) });
    const e = new CohereEmbedder({ apiKey: "k", fetchFn });
    const v = await e.embed("x");
    expect(v.length).toBe(1024);
  });
});

describe("MistralEmbedder (KJC-TSK-0446)", () => {
  it("rejects without api key", () => {
    const prev = process.env.KJ_MISTRAL_KEY;
    delete process.env.KJ_MISTRAL_KEY;
    try { expect(() => new MistralEmbedder({})).toThrow(MistralEmbedderError); }
    finally { if (prev !== undefined) process.env.KJ_MISTRAL_KEY = prev; }
  });

  it("POSTs to api.mistral.ai + returns Float32Array", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: new Array(1024).fill(0.5) }] }) });
    const e = new MistralEmbedder({ apiKey: "ms-test", fetchFn });
    const v = await e.embed("router config");
    expect(v.length).toBe(1024);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.mistral.ai/v1/embeddings");
  });
});

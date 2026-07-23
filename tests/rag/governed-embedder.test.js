// KJC-TSK-0682 (card filed by the karajan-rag session) — chunks of private
// code must pass sensitivity policy + PII redaction before travelling to a
// cloud embedder. Local providers (ollama/onnx) are always allowed and
// untouched; cloud requires an EXPLICIT rag.sensitivity: public.

import { describe, it, expect, vi, beforeEach } from "vitest";

const innerEmbedder = {
  dim: 1024, model: "test-model",
  embed: vi.fn().mockResolvedValue(new Float32Array(4)),
  embedBatch: vi.fn().mockResolvedValue([new Float32Array(4)]),
};
const makeEmbedderMock = vi.fn(() => innerEmbedder);
vi.mock("../../src/rag/embedders/factory.js", () => ({ makeEmbedder: (...a) => makeEmbedderMock(...a) }));

import { makeGovernedEmbedder } from "../../src/rag/governed-embedder.js";

const cfg = (provider, sensitivity) => ({ rag: { embedder: { provider }, ...(sensitivity ? { sensitivity } : {}) } });

beforeEach(() => { vi.clearAllMocks(); });

describe("makeGovernedEmbedder", () => {
  it("local providers pass through untouched regardless of sensitivity", async () => {
    for (const provider of ["ollama", "onnx"]) {
      const e = makeGovernedEmbedder(cfg(provider, "confidential"));
      expect(e).toBe(innerEmbedder); // no wrapper, no redaction overhead
    }
  });

  it("cloud providers are BLOCKED under the default sensitivity (internal)", () => {
    for (const provider of ["openai", "voyage", "cohere", "mistral"]) {
      expect(() => makeGovernedEmbedder(cfg(provider)))
        .toThrow(/sensitivity|public/);
    }
    expect(makeEmbedderMock).not.toHaveBeenCalled(); // fails before creating anything
  });

  it("cloud + explicit public is allowed but PII is redacted before embedding", async () => {
    const e = makeGovernedEmbedder(cfg("openai", "public"));
    await e.embed("contact mjx@example.com for access");
    expect(innerEmbedder.embed.mock.calls[0][0]).not.toContain("mjx@example.com");
    expect(innerEmbedder.embed.mock.calls[0][0]).toContain("[REDACTED_EMAIL]");

    await e.embedBatch(["a@b.co", "clean text"]);
    const batch = innerEmbedder.embedBatch.mock.calls[0][0];
    expect(batch[0]).toContain("[REDACTED_EMAIL]");
    expect(batch[1]).toBe("clean text");
    expect(e.dim).toBe(1024); // interface preserved
    expect(e.model).toBe("test-model");
  });

  it("cloud + confidential is blocked even if someone sets it explicitly", () => {
    expect(() => makeGovernedEmbedder(cfg("voyage", "confidential"))).toThrow(/confidential/);
  });
});

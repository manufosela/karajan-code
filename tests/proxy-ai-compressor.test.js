import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";
import { compressWithAI, isAICompressionAvailable, PROVIDERS } from "../src/proxy/compression/ai-compressor.js";

// ---------------------------------------------------------------------------
// Helpers — mock https.request
// ---------------------------------------------------------------------------
function mockHttpsRequest(responseBody, statusCode = 200) {
  const spy = vi.spyOn(https, "request");
  spy.mockImplementation((_opts, callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    process.nextTick(() => {
      callback(res);
      res.emit("data", Buffer.from(JSON.stringify(responseBody)));
      res.emit("end");
    });
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    return req;
  });
  return spy;
}

function mockHttpsRequestError(errorMessage) {
  const spy = vi.spyOn(https, "request");
  spy.mockImplementation(() => {
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    process.nextTick(() => req.emit("error", new Error(errorMessage)));
    return req;
  });
  return spy;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ai-compressor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // isAICompressionAvailable
  // -----------------------------------------------------------------------
  describe("isAICompressionAvailable", () => {
    it("returns false when config is null/undefined", () => {
      expect(isAICompressionAvailable(null)).toBe(false);
      expect(isAICompressionAvailable(undefined)).toBe(false);
    });

    it("returns false when disabled", () => {
      expect(isAICompressionAvailable({ enabled: false, apiKey: "key" })).toBe(false);
    });

    it("returns false when no apiKey", () => {
      expect(isAICompressionAvailable({ enabled: true })).toBe(false);
      expect(isAICompressionAvailable({ enabled: true, apiKey: "" })).toBe(false);
    });

    it("returns false for unknown provider", () => {
      expect(isAICompressionAvailable({ enabled: true, apiKey: "key", provider: "unknown" })).toBe(false);
    });

    it("returns true when enabled with apiKey and valid provider", () => {
      expect(isAICompressionAvailable({ enabled: true, apiKey: "key", provider: "anthropic" })).toBe(true);
      expect(isAICompressionAvailable({ enabled: true, apiKey: "key", provider: "openai" })).toBe(true);
      expect(isAICompressionAvailable({ enabled: true, apiKey: "key", provider: "gemini" })).toBe(true);
    });

    it("defaults to anthropic provider when none specified", () => {
      expect(isAICompressionAvailable({ enabled: true, apiKey: "key" })).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Disabled mode
  // -----------------------------------------------------------------------
  describe("disabled mode", () => {
    it("returns original text when not enabled", async () => {
      const result = await compressWithAI("long text here", { enabled: false, apiKey: "key" });
      expect(result.compressed).toBe("long text here");
      expect(result.tokensUsed).toEqual({ input: 0, output: 0 });
      expect(result.cost).toBe(0);
    });

    it("returns original text when no apiKey", async () => {
      const result = await compressWithAI("long text here", { enabled: true });
      expect(result.compressed).toBe("long text here");
    });

    it("returns original text with default options", async () => {
      const result = await compressWithAI("text");
      expect(result.compressed).toBe("text");
    });

    it("returns original text for unknown provider", async () => {
      const result = await compressWithAI("text", { enabled: true, apiKey: "key", provider: "unknown" });
      expect(result.compressed).toBe("text");
      expect(result.cost).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Successful compression — Anthropic
  // -----------------------------------------------------------------------
  describe("anthropic provider", () => {
    it("compresses text and returns usage info", async () => {
      const spy = mockHttpsRequest({
        content: [{ type: "text", text: "compressed output" }],
        usage: { input_tokens: 100, output_tokens: 20 }
      });

      const result = await compressWithAI("very long text to compress", {
        enabled: true,
        apiKey: "test-key",
        provider: "anthropic"
      });

      expect(result.compressed).toBe("compressed output");
      expect(result.tokensUsed).toEqual({ input: 100, output: 20 });
      expect(result.cost).toBeGreaterThan(0);

      // Verify request format
      const [reqOpts] = spy.mock.calls[0];
      expect(reqOpts.hostname).toBe("api.anthropic.com");
      expect(reqOpts.path).toBe("/v1/messages");
      expect(reqOpts.headers["x-api-key"]).toBe("test-key");
      expect(reqOpts.headers["anthropic-version"]).toBe("2023-06-01");
    });

    it("uses default model when none specified", async () => {
      mockHttpsRequest({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const result = await compressWithAI("text", {
        enabled: true,
        apiKey: "key",
        provider: "anthropic"
      });

      expect(result.compressed).toBe("ok");
    });

    it("calculates cost correctly", async () => {
      mockHttpsRequest({
        content: [{ type: "text", text: "short" }],
        usage: { input_tokens: 1000, output_tokens: 200 }
      });

      const result = await compressWithAI("text", {
        enabled: true,
        apiKey: "key",
        provider: "anthropic"
      });

      const expectedCost =
        1000 * PROVIDERS.anthropic.costPerInputToken +
        200 * PROVIDERS.anthropic.costPerOutputToken;
      expect(result.cost).toBeCloseTo(expectedCost, 10);
    });
  });

  // -----------------------------------------------------------------------
  // Successful compression — OpenAI
  // -----------------------------------------------------------------------
  describe("openai provider", () => {
    it("compresses text and returns usage info", async () => {
      const spy = mockHttpsRequest({
        choices: [{ message: { content: "openai compressed" } }],
        usage: { prompt_tokens: 80, completion_tokens: 15 }
      });

      const result = await compressWithAI("long text", {
        enabled: true,
        apiKey: "sk-test",
        provider: "openai"
      });

      expect(result.compressed).toBe("openai compressed");
      expect(result.tokensUsed).toEqual({ input: 80, output: 15 });
      expect(result.cost).toBeGreaterThan(0);

      const [reqOpts] = spy.mock.calls[0];
      expect(reqOpts.hostname).toBe("api.openai.com");
      expect(reqOpts.path).toBe("/v1/chat/completions");
      expect(reqOpts.headers.Authorization).toBe("Bearer sk-test");
    });
  });

  // -----------------------------------------------------------------------
  // Successful compression — Gemini
  // -----------------------------------------------------------------------
  describe("gemini provider", () => {
    it("compresses text and returns usage info", async () => {
      const spy = mockHttpsRequest({
        candidates: [{ content: { parts: [{ text: "gemini compressed" }] } }],
        usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 12 }
      });

      const result = await compressWithAI("long text", {
        enabled: true,
        apiKey: "gem-key",
        provider: "gemini"
      });

      expect(result.compressed).toBe("gemini compressed");
      expect(result.tokensUsed).toEqual({ input: 60, output: 12 });
      expect(result.cost).toBeGreaterThan(0);

      const [reqOpts] = spy.mock.calls[0];
      expect(reqOpts.hostname).toBe("generativelanguage.googleapis.com");
      expect(reqOpts.path).toContain("gemini-2.0-flash-lite");
      expect(reqOpts.path).toContain("key=gem-key");
    });

    it("allows custom model", async () => {
      const spy = mockHttpsRequest({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
      });

      await compressWithAI("text", {
        enabled: true,
        apiKey: "key",
        provider: "gemini",
        model: "gemini-2.0-flash"
      });

      const [reqOpts] = spy.mock.calls[0];
      expect(reqOpts.path).toContain("gemini-2.0-flash");
    });
  });

  // -----------------------------------------------------------------------
  // API failure fallback
  // -----------------------------------------------------------------------
  describe("API failure fallback", () => {
    it("returns original text on HTTP error", async () => {
      mockHttpsRequest({ error: "rate limited" }, 429);

      const result = await compressWithAI("original text", {
        enabled: true,
        apiKey: "key",
        provider: "anthropic"
      });

      expect(result.compressed).toBe("original text");
      expect(result.tokensUsed).toEqual({ input: 0, output: 0 });
      expect(result.cost).toBe(0);
    });

    it("returns original text on network error", async () => {
      mockHttpsRequestError("ECONNREFUSED");

      const result = await compressWithAI("original text", {
        enabled: true,
        apiKey: "key",
        provider: "openai"
      });

      expect(result.compressed).toBe("original text");
      expect(result.cost).toBe(0);
    });

    it("returns original text when response has empty content", async () => {
      mockHttpsRequest({
        content: [{ type: "text", text: "" }],
        usage: { input_tokens: 50, output_tokens: 0 }
      });

      const result = await compressWithAI("original text", {
        enabled: true,
        apiKey: "key",
        provider: "anthropic"
      });

      expect(result.compressed).toBe("original text");
    });
  });

  // -----------------------------------------------------------------------
  // Provider request format validation
  // -----------------------------------------------------------------------
  describe("provider request formats", () => {
    it("anthropic sends correct body structure", () => {
      const req = PROVIDERS.anthropic.buildRequest("hello", "claude-3-5-haiku-20241022", "key", 512);
      const body = JSON.parse(req.body);
      expect(body.model).toBe("claude-3-5-haiku-20241022");
      expect(body.max_tokens).toBe(512);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
    });

    it("openai sends correct body structure", () => {
      const req = PROVIDERS.openai.buildRequest("hello", "gpt-4o-mini", "key", 512);
      const body = JSON.parse(req.body);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.max_tokens).toBe(512);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
      expect(req.headers.Authorization).toBe("Bearer key");
    });

    it("gemini sends correct body structure", () => {
      const req = PROVIDERS.gemini.buildRequest("hello", "gemini-2.0-flash-lite", "key", 512);
      const body = JSON.parse(req.body);
      expect(body.contents).toHaveLength(1);
      expect(body.generationConfig.maxOutputTokens).toBe(512);
      expect(req.path).toContain("key=key");
      expect(req.path).toContain("gemini-2.0-flash-lite");
    });
  });
});

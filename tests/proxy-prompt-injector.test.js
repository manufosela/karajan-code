import { describe, it, expect, beforeEach } from "vitest";
import {
  PromptInjectionRegistry,
  createPromptInjector,
} from "../src/proxy/middleware/prompt-injector.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a minimal ctx object mimicking what proxy-server.js provides.
 */
function makeCtx({ provider = "anthropic", method = "POST", body = "{}" } = {}) {
  return {
    req: {
      method,
      headers: {
        "content-length": String(Buffer.byteLength(body)),
      },
    },
    res: {},
    body,
    provider,
    modifiedBody: null,
  };
}

/** Noop next() that resolves immediately. */
const noop = () => Promise.resolve();

/* ------------------------------------------------------------------ */
/*  PromptInjectionRegistry                                            */
/* ------------------------------------------------------------------ */

describe("PromptInjectionRegistry", () => {
  let registry;

  beforeEach(() => {
    registry = new PromptInjectionRegistry();
  });

  it("returns empty string when no entries are registered", () => {
    expect(registry.getAll()).toBe("");
  });

  it("returns single registered content", () => {
    registry.register("a", "hello");
    expect(registry.getAll()).toBe("hello");
  });

  it("concatenates multiple entries with newlines", () => {
    registry.register("a", "first");
    registry.register("b", "second");
    expect(registry.getAll()).toBe("first\nsecond");
  });

  it("overwrites content for the same key", () => {
    registry.register("a", "v1");
    registry.register("a", "v2");
    expect(registry.getAll()).toBe("v2");
  });

  it("unregister removes a key", () => {
    registry.register("a", "hello");
    registry.unregister("a");
    expect(registry.getAll()).toBe("");
  });

  it("clear removes all entries", () => {
    registry.register("a", "1");
    registry.register("b", "2");
    registry.clear();
    expect(registry.getAll()).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/*  Middleware — empty registry passthrough                            */
/* ------------------------------------------------------------------ */

describe("createPromptInjector — empty registry", () => {
  it("does not modify ctx when registry is empty", async () => {
    const registry = new PromptInjectionRegistry();
    const mw = createPromptInjector(registry);
    const body = JSON.stringify({ system: "original" });
    const ctx = makeCtx({ provider: "anthropic", body });

    await mw(ctx, noop);

    expect(ctx.modifiedBody).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Middleware — Anthropic provider                                     */
/* ------------------------------------------------------------------ */

describe("createPromptInjector — Anthropic", () => {
  let registry, mw;

  beforeEach(() => {
    registry = new PromptInjectionRegistry();
    registry.register("test", "INJECTED");
    mw = createPromptInjector(registry);
  });

  it("appends to string system prompt", async () => {
    const body = JSON.stringify({ system: "You are helpful.", messages: [] });
    const ctx = makeCtx({ provider: "anthropic", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.system).toBe("You are helpful.\nINJECTED");
  });

  it("appends to array system prompt", async () => {
    const body = JSON.stringify({
      system: [{ type: "text", text: "You are helpful." }],
      messages: [],
    });
    const ctx = makeCtx({ provider: "anthropic", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.system).toHaveLength(2);
    expect(parsed.system[1]).toEqual({ type: "text", text: "INJECTED" });
  });

  it("creates system prompt when none exists", async () => {
    const body = JSON.stringify({ messages: [] });
    const ctx = makeCtx({ provider: "anthropic", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.system).toBe("INJECTED");
  });
});

/* ------------------------------------------------------------------ */
/*  Middleware — OpenAI provider                                       */
/* ------------------------------------------------------------------ */

describe("createPromptInjector — OpenAI", () => {
  let registry, mw;

  beforeEach(() => {
    registry = new PromptInjectionRegistry();
    registry.register("test", "INJECTED");
    mw = createPromptInjector(registry);
  });

  it("appends to existing system message content", async () => {
    const body = JSON.stringify({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    const ctx = makeCtx({ provider: "openai", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.messages[0].content).toBe("You are helpful.\nINJECTED");
  });

  it("prepends system message when first message is not system", async () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: "Hi" }],
    });
    const ctx = makeCtx({ provider: "openai", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.messages[0]).toEqual({ role: "system", content: "INJECTED" });
    expect(parsed.messages[1]).toEqual({ role: "user", content: "Hi" });
  });

  it("creates messages array when missing", async () => {
    const body = JSON.stringify({ model: "gpt-4" });
    const ctx = makeCtx({ provider: "openai", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.messages).toEqual([{ role: "system", content: "INJECTED" }]);
  });
});

/* ------------------------------------------------------------------ */
/*  Middleware — Gemini provider                                       */
/* ------------------------------------------------------------------ */

describe("createPromptInjector — Gemini", () => {
  let registry, mw;

  beforeEach(() => {
    registry = new PromptInjectionRegistry();
    registry.register("test", "INJECTED");
    mw = createPromptInjector(registry);
  });

  it("appends part to existing systemInstruction", async () => {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: "You are helpful." }] },
      contents: [],
    });
    const ctx = makeCtx({ provider: "gemini", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.systemInstruction.parts).toHaveLength(2);
    expect(parsed.systemInstruction.parts[1]).toEqual({ text: "INJECTED" });
  });

  it("creates systemInstruction when missing", async () => {
    const body = JSON.stringify({ contents: [] });
    const ctx = makeCtx({ provider: "gemini", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.systemInstruction).toEqual({ parts: [{ text: "INJECTED" }] });
  });
});

/* ------------------------------------------------------------------ */
/*  Content-Length recalculation                                        */
/* ------------------------------------------------------------------ */

describe("createPromptInjector — Content-Length", () => {
  it("recalculates Content-Length after injection", async () => {
    const registry = new PromptInjectionRegistry();
    registry.register("k", "extra content here");
    const mw = createPromptInjector(registry);

    const body = JSON.stringify({ system: "short" });
    const ctx = makeCtx({ provider: "anthropic", body });

    await mw(ctx, noop);

    const expectedLength = Buffer.byteLength(ctx.modifiedBody);
    expect(ctx.req.headers["content-length"]).toBe(String(expectedLength));
  });

  it("handles multi-byte characters correctly", async () => {
    const registry = new PromptInjectionRegistry();
    registry.register("k", "emoji: \u{1F680} and accents: \u00E9\u00E0\u00FC");
    const mw = createPromptInjector(registry);

    const body = JSON.stringify({ system: "base" });
    const ctx = makeCtx({ provider: "anthropic", body });

    await mw(ctx, noop);

    const expectedLength = Buffer.byteLength(ctx.modifiedBody);
    expect(ctx.req.headers["content-length"]).toBe(String(expectedLength));
    expect(Number(ctx.req.headers["content-length"])).toBeGreaterThan(ctx.modifiedBody.length);
  });
});

/* ------------------------------------------------------------------ */
/*  Middleware — multiple registrations                                 */
/* ------------------------------------------------------------------ */

describe("createPromptInjector — multiple registrations", () => {
  it("injects all registered content concatenated", async () => {
    const registry = new PromptInjectionRegistry();
    registry.register("rules", "Rule 1: be safe");
    registry.register("context", "Context: user is admin");
    registry.register("extra", "Extra: verbose mode");
    const mw = createPromptInjector(registry);

    const body = JSON.stringify({ system: "Base prompt." });
    const ctx = makeCtx({ provider: "anthropic", body });

    await mw(ctx, noop);

    const parsed = JSON.parse(ctx.modifiedBody);
    expect(parsed.system).toBe(
      "Base prompt.\nRule 1: be safe\nContext: user is admin\nExtra: verbose mode",
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Middleware — non-POST and invalid JSON passthrough                  */
/* ------------------------------------------------------------------ */

describe("createPromptInjector — passthrough cases", () => {
  let registry, mw;

  beforeEach(() => {
    registry = new PromptInjectionRegistry();
    registry.register("k", "content");
    mw = createPromptInjector(registry);
  });

  it("passes through GET requests unchanged", async () => {
    const ctx = makeCtx({ method: "GET", body: "" });

    await mw(ctx, noop);

    expect(ctx.modifiedBody).toBeNull();
  });

  it("passes through non-JSON body unchanged", async () => {
    const ctx = makeCtx({ body: "not valid json {{{" });

    await mw(ctx, noop);

    expect(ctx.modifiedBody).toBeNull();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

// v2.30.0 — RAG controls in EDITABLE_FIELDS.
// Verifies that the board can read/write the RAG keys that the code
// actually reads today: rag.preload.{enabled,topK,scope} (consumed in
// src/orchestrator/stages/rag-context-stage.js) and rag.embedder.provider
// (consumed in src/rag/embedders/factory.js).

let home;
let originalEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-cfg-rag-"));
  originalEnv = process.env.KARAJAN_HOME;
  process.env.KARAJAN_HOME = home;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.KARAJAN_HOME;
  else process.env.KARAJAN_HOME = originalEnv;
  rmSync(home, { recursive: true, force: true });
});

const { readConfig, writeConfigPatch, EDITABLE_FIELDS } = await import(
  "../../packages/hu-board/src/config-yaml.js"
);

describe("config-yaml — RAG controls (v2.30.0)", () => {
  it("exposes the four documented RAG fields with the expected shape", () => {
    const get = (k) => EDITABLE_FIELDS.find((f) => f.key === k);

    const preloadEnabled = get("ragPreloadEnabled");
    expect(preloadEnabled).toBeDefined();
    expect(preloadEnabled.type).toBe("boolean");
    expect(preloadEnabled.path).toBe("rag.preload.enabled");

    const topK = get("ragPreloadTopK");
    expect(topK.type).toBe("number");
    expect(topK.path).toBe("rag.preload.topK");
    expect(topK.min).toBe(1);
    expect(topK.max).toBe(20);

    const scope = get("ragPreloadScope");
    expect(scope.type).toBe("select");
    expect(scope.path).toBe("rag.preload.scope");
    expect(scope.options).toEqual(["all", "code", "plans", "onboarding"]);

    const provider = get("ragEmbedderProvider");
    expect(provider.type).toBe("select");
    expect(provider.path).toBe("rag.embedder.provider");
    expect(provider.options).toEqual([
      "ollama",
      "openai",
      "voyage",
      "cohere",
      "mistral",
      "onnx",
    ]);
  });

  it("readConfig returns documented defaults when the yml is absent", () => {
    const out = readConfig();
    expect(out.exists).toBe(false);
    const get = (k) => out.fields.find((f) => f.key === k).value;
    expect(get("ragPreloadEnabled")).toBe(false);
    expect(get("ragPreloadTopK")).toBe(5);
    expect(get("ragPreloadScope")).toBe("all");
    expect(get("ragEmbedderProvider")).toBe("ollama");
  });

  it("writeConfigPatch persists every RAG field under the right yml path", () => {
    const res = writeConfigPatch({
      ragPreloadEnabled: true,
      ragPreloadTopK: 8,
      ragPreloadScope: "code",
      ragEmbedderProvider: "voyage",
    });
    expect(res.written).toBe(true);
    expect(res.errors).toEqual([]);

    const parsed = yaml.load(readFileSync(res.path, "utf8"));
    expect(parsed.rag.preload.enabled).toBe(true);
    expect(parsed.rag.preload.topK).toBe(8);
    expect(parsed.rag.preload.scope).toBe("code");
    expect(parsed.rag.embedder.provider).toBe("voyage");
  });

  it("re-reading after a write reflects the persisted RAG values", () => {
    writeConfigPatch({
      ragPreloadEnabled: true,
      ragEmbedderProvider: "onnx",
    });
    const out = readConfig();
    const get = (k) => out.fields.find((f) => f.key === k).value;
    expect(get("ragPreloadEnabled")).toBe(true);
    expect(get("ragEmbedderProvider")).toBe("onnx");
    expect(get("ragPreloadTopK")).toBe(5); // unchanged → default
    expect(get("ragPreloadScope")).toBe("all"); // unchanged → default
  });

  it("rejects topK out of [1,20] with a clear error and does not write", () => {
    const tooHigh = writeConfigPatch({ ragPreloadTopK: 50 });
    expect(tooHigh.written).toBe(false);
    expect(tooHigh.errors.some((e) => e.includes("ragPreloadTopK"))).toBe(true);

    const tooLow = writeConfigPatch({ ragPreloadTopK: 0 });
    expect(tooLow.written).toBe(false);
    expect(tooLow.errors.some((e) => e.includes("ragPreloadTopK"))).toBe(true);

    expect(existsSync(join(home, "kj.config.yml"))).toBe(false);
  });

  it("rejects unknown embedder providers", () => {
    const res = writeConfigPatch({ ragEmbedderProvider: "claude-magic" });
    expect(res.written).toBe(false);
    expect(res.errors.some((e) => e.includes("ragEmbedderProvider"))).toBe(true);
    expect(existsSync(join(home, "kj.config.yml"))).toBe(false);
  });

  it("rejects unknown scope values", () => {
    const res = writeConfigPatch({ ragPreloadScope: "everywhere" });
    expect(res.written).toBe(false);
    expect(res.errors.some((e) => e.includes("ragPreloadScope"))).toBe(true);
  });
});

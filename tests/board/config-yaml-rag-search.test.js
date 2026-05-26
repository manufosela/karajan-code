import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

// KJC-TSK-0463 — RAG search-time knobs (rag.search.{mode,alpha,rerank})
// exposed in EDITABLE_FIELDS, persisted to yml, and consumed by the
// pre-loop retrieval stage (rag-context-stage.js).

let home;
let originalEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-cfg-ragsearch-"));
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
const { resolveSearchOpts } = await import(
  "../../src/orchestrator/stages/rag-context-stage.js"
);

describe("config-yaml — RAG search knobs (KJC-TSK-0463)", () => {
  it("exposes ragSearchMode/Alpha/Rerank with the expected shape", () => {
    const get = (k) => EDITABLE_FIELDS.find((f) => f.key === k);

    const mode = get("ragSearchMode");
    expect(mode).toBeDefined();
    expect(mode.type).toBe("select");
    expect(mode.path).toBe("rag.search.mode");
    expect(mode.options).toEqual(["hybrid", "semantic", "keyword"]);
    expect(mode.default).toBe("hybrid");

    const alpha = get("ragSearchAlpha");
    expect(alpha.type).toBe("number");
    expect(alpha.path).toBe("rag.search.alpha");
    expect(alpha.min).toBe(0);
    expect(alpha.max).toBe(1);
    expect(alpha.default).toBe(0.6);

    const rerank = get("ragSearchRerank");
    expect(rerank.type).toBe("boolean");
    expect(rerank.path).toBe("rag.search.rerank");
    expect(rerank.default).toBe(false);
  });

  it("writeConfigPatch persists the three keys under rag.search", () => {
    const res = writeConfigPatch({
      ragSearchMode: "semantic",
      ragSearchAlpha: 0.8,
      ragSearchRerank: true,
    });
    expect(res.written).toBe(true);
    const parsed = yaml.load(readFileSync(res.path, "utf8"));
    expect(parsed.rag.search.mode).toBe("semantic");
    expect(parsed.rag.search.alpha).toBe(0.8);
    expect(parsed.rag.search.rerank).toBe(true);
  });

  it("rejects unknown mode values and alpha out of [0,1]", () => {
    const badMode = writeConfigPatch({ ragSearchMode: "fuzzy-magic" });
    expect(badMode.written).toBe(false);
    expect(badMode.errors.some((e) => e.includes("ragSearchMode"))).toBe(true);

    const badAlpha = writeConfigPatch({ ragSearchAlpha: 1.5 });
    expect(badAlpha.written).toBe(false);
    expect(badAlpha.errors.some((e) => e.includes("ragSearchAlpha"))).toBe(true);
  });

  it("readConfig returns documented defaults when yml is absent", () => {
    const out = readConfig();
    const get = (k) => out.fields.find((f) => f.key === k).value;
    expect(get("ragSearchMode")).toBe("hybrid");
    expect(get("ragSearchAlpha")).toBe(0.6);
    expect(get("ragSearchRerank")).toBe(false);
  });
});

describe("rag-context-stage — resolveSearchOpts (KJC-TSK-0463)", () => {
  it("falls back to defaults when rag.search is absent", () => {
    const out = resolveSearchOpts({});
    expect(out.mode).toBe("hybrid");
    expect(out.alpha).toBe(0.6);
    expect(out.rerankOpts).toBeUndefined();
  });

  it("forwards explicit mode/alpha as-is", () => {
    const out = resolveSearchOpts({ rag: { search: { mode: "keyword", alpha: 0.2 } } });
    expect(out.mode).toBe("keyword");
    expect(out.alpha).toBe(0.2);
  });

  it("maps rerank=true to an empty rerankOpts object", () => {
    const out = resolveSearchOpts({ rag: { search: { rerank: true } } });
    expect(out.rerankOpts).toEqual({});
  });

  it("forwards an object-shaped rerank config verbatim", () => {
    const cfg = { rag: { search: { rerank: { provider: "cohere", model: "rerank-3" } } } };
    const out = resolveSearchOpts(cfg);
    expect(out.rerankOpts).toEqual({ provider: "cohere", model: "rerank-3" });
  });

  it("ignores non-finite alpha (NaN, string) and falls back to default", () => {
    expect(resolveSearchOpts({ rag: { search: { alpha: "nope" } } }).alpha).toBe(0.6);
    expect(resolveSearchOpts({ rag: { search: { alpha: NaN } } }).alpha).toBe(0.6);
  });
});

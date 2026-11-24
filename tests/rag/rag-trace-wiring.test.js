// HU-4867 (KJC-TSK-1770): the MCP handler leaves its trace line with source "mcp" and never the query text.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countChunks } from "../../src/rag/vec-store.js";

vi.mock("../../src/mcp/shared-helpers.js", async () => {
  const actual = await vi.importActual("../../src/mcp/shared-helpers.js");
  return {
    ...actual,
    resolveProjectDir: vi.fn(async (_s, dir) => dir),
    buildConfig: vi.fn(async (args) => ({ projectDir: args.projectDir, rag: { embedder: { dim: 8 } } })),
  };
});
vi.mock("../../src/rag/project-store.js", () => ({ openProjectStore: () => ({ close() {} }) }));
vi.mock("../../src/rag/vec-store.js", () => ({ countChunks: vi.fn(() => 3), projectSlug: () => "p" }));
vi.mock("../../src/rag/migrate.js", () => ({ countProjectChunks: () => 3, emptyIndexRemedy: () => "" }));
vi.mock("../../src/rag/governed-embedder.js", () => ({ makeGovernedEmbedder: () => ({}) }));
vi.mock("../../src/rag/retriever.js", () => ({ query: async () => [{ source: "src/a.js", text: "code" }] }));
vi.mock("../../src/rag/path-hits.js", () => ({ pathNamedHits: () => [], withPathNamedHits: (_p, ranked) => ranked }));
vi.mock("../../src/rag/answer-note.js", () => ({ noteRagAnswer() {}, noteRagQuery() {} }));

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-wiring-"));
  fs.mkdirSync(path.join(dir, ".karajan"));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("kj_rag_query trace (HU-4867)", () => {
  it("writes one mcp line with the hit count and not the query text", async () => {
    const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");
    await handleRagQuery({ text: "where is the secret token", projectDir: dir }, {});
    const raw = fs.readFileSync(path.join(dir, ".karajan/traces/rag.jsonl"), "utf8");
    const [line] = raw.trim().split("\n").map((l) => JSON.parse(l));
    expect(line).toMatchObject({ source: "mcp", hits: 1, stale: null });
    expect(raw).not.toMatch(/secret|src\/a\.js/);
  });

  it("an empty index answers too: one line with no hits, and not the query text", async () => {
    countChunks.mockReturnValueOnce(0);
    const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");
    await handleRagQuery({ text: "where is the secret token", projectDir: dir }, {});
    const raw = fs.readFileSync(path.join(dir, ".karajan/traces/rag.jsonl"), "utf8");
    expect(raw.trim().split("\n").map((l) => JSON.parse(l))).toMatchObject([{ source: "mcp", hits: 0, stale: null }]);
    expect(raw).not.toMatch(/secret/);
  });
});

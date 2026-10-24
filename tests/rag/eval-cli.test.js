// KJC-TSK-0483 — CLI smoke test for `kj rag eval`. Drives ragEvalCommand
// with a fake embedder + a tiny indexed corpus + an inline golden file,
// and pins the public contract: structured logging, --json output shape,
// and the --min-recall exit-code gate.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("karajan-core/rag/embedder", () => {
  class FakeEmbedder {
    constructor() { this.dim = 8; }
    async embed() { const v = new Float32Array(8); v[0] = 1; return v; }
    async embedBatch(ts) { return ts.map(() => { const v = new Float32Array(8); v[0] = 1; return v; }); }
  }
  return { OllamaEmbedder: FakeEmbedder, OllamaEmbedderError: class extends Error {} };
});

describe("kj rag eval CLI — KJC-TSK-0483", () => {
  let root, prevHome, prevDb, prevExit;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-rag-eval-"));
    prevHome = process.env.KARAJAN_HOME;
    prevDb = process.env.KJ_RAG_DB;
    prevExit = process.exitCode;
    process.env.KARAJAN_HOME = join(root, ".karajan");
    process.env.KJ_RAG_DB = join(root, "rag.db");
    mkdirSync(process.env.KARAJAN_HOME, { recursive: true });
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
    if (prevDb === undefined) delete process.env.KJ_RAG_DB; else process.env.KJ_RAG_DB = prevDb;
    process.exitCode = prevExit;
  });

  async function indexFixture(slug = "ev") {
    const { ragIndexCommand } = await import("../../src/commands/rag.js");
    const projectDir = join(root, slug);
    mkdirSync(projectDir);
    mkdirSync(join(process.env.KARAJAN_HOME, "plans", slug), { recursive: true });
    writeFileSync(
      join(process.env.KARAJAN_HOME, "plans", slug, "plan-001.json"),
      JSON.stringify({ hus: [{ id: "A", title: "alpha auth", description: "implement auth handler" }] })
    );
    await ragIndexCommand({ config: { projectDir, rag: { embedder: { dim: 8 } } }, logger: noopLogger, flags: {} });
    return projectDir;
  }

  function writeGolden(entries) {
    const file = join(root, "golden.json");
    writeFileSync(file, JSON.stringify(entries));
    return file;
  }

  it("emits report JSON with aggregate + per-query results", async () => {
    const projectDir = await indexFixture("ev1");
    const golden = writeGolden([{ query: "auth", expected_sources: ["plan-001.json"] }]);
    const { ragEvalCommand } = await import("../../src/commands/rag.js");
    const chunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { chunks.push(String(s)); return true; };
    try {
      await ragEvalCommand({
        config: { projectDir, rag: { embedder: { dim: 8 } } },
        logger: noopLogger,
        flags: { golden, json: true, topK: 5, project: "all" },
      });
    } finally {
      process.stdout.write = origWrite;
    }
    const report = JSON.parse(chunks.join("").trim());
    expect(report.aggregate.n).toBe(1);
    expect(report.aggregate.recall["@5"]).toBeGreaterThanOrEqual(0);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].query).toBe("auth");
  });

  it("sets process.exitCode=1 when --min-recall threshold fails", async () => {
    const projectDir = await indexFixture("ev2");
    const golden = writeGolden([
      { query: "totally-unrelated-term", expected_sources: ["does-not-exist.js"] },
    ]);
    const { ragEvalCommand } = await import("../../src/commands/rag.js");
    process.exitCode = 0;
    await ragEvalCommand({
      config: { projectDir, rag: { embedder: { dim: 8 } } },
      logger: noopLogger,
      flags: { golden, topK: 5, minRecall: 0.9, project: "all" },
    });
    expect(process.exitCode).toBe(1);
    expect(noopLogger.error).toHaveBeenCalledWith(expect.stringMatching(/below --min-recall/));
  });

  // KJC-TSK-1170 (RAG-E): --save-baseline freezes the numbers; --baseline fails on a regression.
  it("--save-baseline writes the aggregate with latency, and --baseline fails when recall dropped", async () => {
    const projectDir = await indexFixture("ev4");
    const golden = writeGolden([{ query: "auth", expected_sources: ["plan-001.json"] }]);
    const { ragEvalCommand } = await import("../../src/commands/rag.js");
    const baseline = join(root, "baseline.json");
    const config = { projectDir, rag: { embedder: { dim: 8 } } };
    await ragEvalCommand({ config, logger: noopLogger, flags: { golden, topK: 5, project: "all", saveBaseline: baseline } });
    const saved = JSON.parse(readFileSync(baseline, "utf8"));
    expect(saved.aggregate.recall["@5"]).toBe(1);
    expect(saved.aggregate.latency.p95Ms).toBeGreaterThanOrEqual(0);
    expect(saved.measuredAt).toMatch(/^\d{4}-/);
    process.exitCode = 0;
    await ragEvalCommand({ config, logger: noopLogger, flags: { golden, topK: 5, project: "all", baseline } });
    expect(process.exitCode).toBe(0);
    // A golden set the index cannot satisfy, against the same baseline: a regression.
    const worse = writeGolden([{ query: "totally-unrelated-term", expected_sources: ["does-not-exist.js"] }]);
    await ragEvalCommand({ config, logger: noopLogger, flags: { golden: worse, topK: 5, project: "all", baseline } });
    expect(process.exitCode).toBe(1);
    expect(noopLogger.error).toHaveBeenCalledWith(expect.stringMatching(/worse than the baseline.*recall@5/s));
  });

  it("does not flip exitCode when --min-recall is satisfied", async () => {
    const projectDir = await indexFixture("ev3");
    const golden = writeGolden([{ query: "auth", expected_sources: ["plan-001.json"] }]);
    const { ragEvalCommand } = await import("../../src/commands/rag.js");
    process.exitCode = 0;
    await ragEvalCommand({
      config: { projectDir, rag: { embedder: { dim: 8 } } },
      logger: noopLogger,
      flags: { golden, topK: 5, minRecall: 0, project: "all" },
    });
    expect(process.exitCode).toBe(0);
  });
});

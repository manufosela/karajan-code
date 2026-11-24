// HU-4867 (KJC-TSK-1770): each RAG query leaves a metadata line in .karajan/traces/rag.jsonl, never its text.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { traceRagQuery, staleFromUpdate } from "../../src/rag/rag-trace.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-trace-"));
  fs.mkdirSync(path.join(dir, ".karajan"));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const lines = () => fs.readFileSync(path.join(dir, ".karajan/traces/rag.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("traceRagQuery (HU-4867)", () => {
  it("appends at, source, hits, latencyMs and stale, and nothing else", () => {
    traceRagQuery(dir, { source: "cli", hits: [{ source: "/home/x/src/a.js", text: "code" }, { source: "src/b.js" }], latencyMs: 41.7, stale: false, text: "where is the secret" });
    traceRagQuery(dir, { source: "mcp", hits: [], latencyMs: 3, stale: null });
    const [first, second] = lines();
    expect(Object.keys(first).toSorted()).toEqual(["at", "hits", "latencyMs", "source", "stale"]);
    expect(first).toMatchObject({ source: "cli", hits: 2, latencyMs: 42, stale: false });
    expect(Number.isNaN(Date.parse(first.at))).toBe(false);
    expect(second).toMatchObject({ source: "mcp", hits: 0, latencyMs: 3, stale: null });
    expect(JSON.stringify(lines())).not.toMatch(/secret|\/home\/|src\/b\.js|code/);
  });

  it("only knows the cli and mcp sources", () => {
    traceRagQuery(dir, { source: "/etc/passwd", hits: [], latencyMs: 1, stale: false });
    expect(lines()[0].source).toBe("other");
  });

  it("writes nothing outside a kj project", () => {
    fs.rmSync(path.join(dir, ".karajan"), { recursive: true });
    traceRagQuery(dir, { source: "cli", hits: [], latencyMs: 1, stale: false });
    expect(fs.existsSync(path.join(dir, ".karajan"))).toBe(false);
  });

  it("never breaks the query when the write fails, and warns only once", () => {
    fs.writeFileSync(path.join(dir, ".karajan/traces"), "a file where the folder should be");
    const logger = { warn: vi.fn() };
    expect(() => traceRagQuery(dir, { source: "cli", hits: [], latencyMs: 1, stale: false }, { logger })).not.toThrow();
    expect(() => traceRagQuery(dir, { source: "cli", hits: [], latencyMs: 1, stale: false }, { logger })).not.toThrow();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/rag\.jsonl/);
  });
});

describe("staleFromUpdate (HU-4867)", () => {
  it("is true when the index could not be brought up to date, false when it was, null when not checked", () => {
    expect(staleFromUpdate({ skipped: true, reason: "drift-too-large", changed: 143 })).toBe(true);
    expect(staleFromUpdate({ skipped: true, reason: "bootstrap-failed" })).toBe(true);
    expect(staleFromUpdate({ failed: true, error: "x" })).toBe(true);
    expect(staleFromUpdate({ ran: true })).toBe(false);
    expect(staleFromUpdate({ skipped: true, head: "abc" })).toBe(false);
    expect(staleFromUpdate({ skipped: true })).toBe(null);
    expect(staleFromUpdate(undefined)).toBe(null);
  });
});

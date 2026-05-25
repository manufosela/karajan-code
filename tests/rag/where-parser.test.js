// KJC-TSK-0448 — tests for the --where parser used by `kj rag query`.
import { describe, expect, it } from "vitest";
import { parseWhere, buildWhereSql } from "../../src/rag/where-parser.js";

describe("parseWhere", () => {
  it("returns ok with empty clauses for null / empty input", () => {
    expect(parseWhere(null)).toEqual({ ok: true, clauses: [] });
    expect(parseWhere("")).toEqual({ ok: true, clauses: [] });
    expect(parseWhere("   ")).toEqual({ ok: true, clauses: [] });
  });

  it("parses a single pair", () => {
    expect(parseWhere("symbol=loadConfig")).toEqual({ ok: true, clauses: [["symbol", "loadConfig"]] });
  });

  it("parses multiple pairs joined by AND (case-insensitive)", () => {
    const r = parseWhere("hu_id=HU-003 AND kind=plan and symbol=foo");
    expect(r.ok).toBe(true);
    expect(r.clauses).toEqual([["hu_id", "HU-003"], ["kind", "plan"], ["symbol", "foo"]]);
  });

  it("handles quoted values with spaces", () => {
    const r = parseWhere('headingPath="Architecture Decision Records"');
    expect(r.ok).toBe(true);
    expect(r.clauses).toEqual([["headingPath", "Architecture Decision Records"]]);
  });

  it("rejects malformed input", () => {
    expect(parseWhere("no equals sign here").ok).toBe(false);
    expect(parseWhere("=missing-key").ok).toBe(false);
    expect(parseWhere("key=").ok).toBe(false);
    expect(parseWhere("123key=value").ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(parseWhere(42).ok).toBe(false);
    expect(parseWhere(["k=v"]).ok).toBe(false);
  });
});

describe("buildWhereSql", () => {
  it("emits empty fragment for empty clauses", () => {
    expect(buildWhereSql([])).toEqual({ sql: "", params: [] });
  });

  it("special-cases `kind` to the column", () => {
    expect(buildWhereSql([["kind", "plan"]])).toEqual({ sql: " AND c.kind = ?", params: ["plan"] });
  });

  it("uses json_extract for other keys", () => {
    expect(buildWhereSql([["symbol", "loadConfig"]])).toEqual({
      sql: " AND json_extract(c.metadata, '$.symbol') = ?",
      params: ["loadConfig"],
    });
  });

  it("combines multiple clauses with AND", () => {
    const r = buildWhereSql([["kind", "plan"], ["hu_id", "HU-003"]]);
    expect(r.sql).toBe(" AND c.kind = ? AND json_extract(c.metadata, '$.hu_id') = ?");
    expect(r.params).toEqual(["plan", "HU-003"]);
  });
});

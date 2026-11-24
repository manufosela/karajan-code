// HU-4855 (KJC-TSK-1768): ruleOf and the counters keep known names only, never a path, a command or a hash; days are UTC.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { ruleOf, traceCounters } from "../../src/observe/trace-counters.js";

const DOC = " — doc: https://karajancode.com/docs/guides/sentinel/#";
const countsOf = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "kj-trace-rule-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".karajan", "traces"), { recursive: true });
  for (const [file, record] of Object.entries(files)) writeFileSync(join(dir, ".karajan", file), `${JSON.stringify(record)}\n`);
  return traceCounters(dir);
};

describe("ruleOf (HU-4855)", () => {
  it("keeps the first line, drops the prefix and cuts at the em dash", () => {
    expect(ruleOf("karajan sentinel: rag-first — detalle de src/x.js\nkarajan: obedece")).toBe("rag-first");
    expect(ruleOf("karajan sentinel: merge\nkarajan: obedece")).toBe("merge");
  });

  it("names any other deny by the doc anchor its last message ends with", () => {
    expect(ruleOf(`karajan sentinel: escribir ficheros del repo desde Bash (notes.md)${DOC}bash-write`)).toBe("bash-write");
    expect(ruleOf(`karajan sentinel: kj no arranca${DOC}policy\nkarajan sentinel: steward — bloquea${DOC}steward`)).toBe("steward");
  });

  it("knows every rule the Sentinel denies with, so a new gate is never counted as other", () => {
    const sentinel = readFileSync(new URL("../../src/harden/sentinel/pretooluse-sentinel.mjs", import.meta.url), "utf8");
    const names = [...sentinel.matchAll(/doc\("([a-z-]+)"\)/g)].map(([, name]) => name);
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(ruleOf(`x${DOC}${name}`)).toBe(name);
  });

  it("lets no command, path or hash out: a rule it does not know is other", () => {
    expect(ruleOf("blocked cat /home/x/.env hash abcdef123456")).toBe("other");
    expect(ruleOf("karajan sentinel: regla R-4f37625459 (~/.claude/CLAUDE.md): usa gh auth switch")).toBe("other");
    expect(ruleOf(`karajan sentinel: cat .env${DOC}cat`)).toBe("other");
    expect(ruleOf(undefined)).toBe("other");
  });

  it("keeps commands and hashes out of the serialized counters", () => {
    const denial = { at: "2026-11-24T10:00:00Z", input: { command: "cat .env" }, why: "karajan sentinel: blocked cat .env hash abcdef123456" };
    const out = countsOf({ "traces/denials.jsonl": denial, "traces/commit-gate.jsonl": { at: "2026-11-24T10:00:00Z", outcome: "refuse", rule: "git push 4f37625459" } });
    for (const leak of ["cat", ".env", "git push", "abcdef123456", "4f37625459"]) expect(JSON.stringify(out)).not.toContain(leak);
    expect(out.topBlockingRule).toEqual({ rule: "other", count: 2 });
  });

  it.each([
    ["a piece and an outcome it does not know as other and fail", "traces/method.jsonl",
      { at: "2026-11-24T10:00:00Z", piece: "cat ~/.env", outcome: "constructor" }, ["2026-11-24", "other", "fail"]],
    ["a chokepoint and a decision it does not know as policy-other and fail", "policy-decisions.jsonl",
      { ts: "2026-11-24T10:00:00Z", chokepoint: "git push 4f37625459", decision: "__proto__" }, ["2026-11-24", "policy-other", "fail"]],
    ["a stamp on the UTC day of its instant", "traces/method.jsonl",
      { at: "2026-11-24T23:30:00-02:00", piece: "tdd", outcome: "pass" }, ["2026-11-25", "tdd", "pass"]],
  ])("counts %s", (_, file, record, [day, piece, outcome]) =>
    expect(countsOf({ [file]: record }).rows).toEqual([{ day, piece, outcome, count: 1 }]));

  it("refuses a stamp without a time zone, whose UTC day would depend on the host", () => {
    expect(() => countsOf({ "traces/method.jsonl": { at: "2026-11-24T23:30:00", piece: "tdd", outcome: "pass" } })).toThrow(/line 1: no valid ISO timestamp/);
  });
});

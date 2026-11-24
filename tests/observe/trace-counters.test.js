// HU-4855 (KJC-TSK-1768): the repo's traces turned into counters for the board's observability view.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { traceCounters } from "../../src/observe/trace-counters.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-trace-counters-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (rel, records) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n");
};
const why = (rule) => `karajan sentinel: ${rule} — el RAG no ha respondido sobre src/secret/path.js\nkarajan: obedece`;

describe("traceCounters (HU-4855)", () => {
  it("counts per day, piece and outcome, and names the rule that blocks the most", () => {
    write(".karajan/traces/denials.jsonl", [
      { at: "2026-11-23T10:00:00Z", sid: "s", tool: "Bash", input: { command: "cat /home/x/.env" }, why: why("rag-first") },
      { at: "2026-11-23T11:00:00Z", sid: "s", tool: "Bash", input: { command: "ls" }, why: why("rag-first") },
      { at: "2026-11-23T12:00:00Z", sid: "s", tool: "Bash", input: { command: "ls" }, why: why("expansion de shell") },
    ]);
    write(".karajan/traces/commit-gate.jsonl", [
      { at: "2026-11-23T10:00:00Z", outcome: "pass", rule: "ok" },
      { at: "2026-11-24T10:00:00Z", outcome: "refuse", rule: "commitlint" },
    ]);
    write(".karajan/traces/method.jsonl", [
      { at: "2026-11-24T10:00:00.000Z", piece: "tdd", outcome: "pass" },
      { at: "2026-11-24T10:00:01.000Z", piece: "tdd", outcome: "refuse" },
    ]);
    write(".karajan/policy-decisions.jsonl", [
      { ts: "2026-11-24T10:00:00.000Z", decision: "allow", chokepoint: "commit", policy_hash: "h" },
      { ts: "2026-11-24T10:00:00.000Z", decision: "deny", chokepoint: "tool", policy_hash: "h" },
    ]);
    const out = traceCounters(dir);
    expect(out.missing).toEqual([]);
    expect(out.rows).toEqual([
      { day: "2026-11-23", piece: "commit-gate", outcome: "pass", count: 1 },
      { day: "2026-11-23", piece: "sentinel", outcome: "deny", count: 3 },
      { day: "2026-11-24", piece: "commit-gate", outcome: "fail", count: 1 },
      { day: "2026-11-24", piece: "policy-commit", outcome: "pass", count: 1 },
      { day: "2026-11-24", piece: "policy-tool", outcome: "deny", count: 1 },
      { day: "2026-11-24", piece: "tdd", outcome: "fail", count: 1 },
      { day: "2026-11-24", piece: "tdd", outcome: "pass", count: 1 },
    ]);
    expect(out.topBlockingRule).toEqual({ rule: "rag-first", count: 2 });
  });

  it("never lets a command, a path or a hash out", () => {
    write(".karajan/traces/denials.jsonl", [{ at: "2026-11-23T10:00:00Z", input: { command: "cat /home/x/.env" }, why: "karajan sentinel: blocked src/a/b.js" }]);
    const text = JSON.stringify(traceCounters(dir));
    expect(text).not.toMatch(/\/home\/|\.env|src\/a|policy_hash/);
  });

  it("fails naming the file and the line when a line is not JSON", () => {
    write(".karajan/traces/method.jsonl", [{ at: "2026-11-24T10:00:00Z", piece: "tdd", outcome: "pass" }, "{not json"]);
    expect(() => traceCounters(dir)).toThrow(/method\.jsonl line 2/);
  });

  it("reports a missing trace file as an empty source marked missing", () => {
    write(".karajan/traces/method.jsonl", [{ at: "2026-11-24T10:00:00Z", piece: "sonar", outcome: "pass" }]);
    const out = traceCounters(dir);
    expect(out.missing).toEqual(["commit-gate", "policy", "sentinel"]);
    expect(out.rows).toEqual([{ day: "2026-11-24", piece: "sonar", outcome: "pass", count: 1 }]);
    expect(out.topBlockingRule).toBeNull();
  });
});

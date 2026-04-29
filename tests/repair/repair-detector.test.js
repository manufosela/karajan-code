import { describe, expect, it } from "vitest";
import { classifyFailure, failureSignature, createFailureTracker } from "../../src/orchestrator/repair/repair-detector.js";

describe("repair-detector / failureSignature", () => {
  it("collapses whitespace and digits so flaky line numbers don't break dedup", () => {
    const a = failureSignature("jq -e '.x' f.json", "jq: error at line 12: bad");
    const b = failureSignature("jq -e '.x' f.json", "jq: error  at  line   99: bad");
    expect(a).toBe(b);
  });
  it("normalises absolute paths so cwd differences don't break dedup", () => {
    const a = failureSignature("cmd", "could not open /home/manu/foo");
    const b = failureSignature("cmd", "could not open /tmp/work/foo");
    expect(a).toBe(b);
  });
});

describe("repair-detector / classifyFailure", () => {
  it("returns infeasible=false when consecutive count is below threshold (lets coder retry once)", () => {
    const r = classifyFailure({
      cmd: "jq -e 'BROKEN'", errorOutput: "Cannot index array with string", consecutive: 1,
    });
    expect(r.infeasible).toBe(false);
  });

  it("flags 'jq as-binding misuse' (the 2026-04-29 incident) as infeasible after 2 consecutive failures", () => {
    const r = classifyFailure({
      cmd: "jq -e '[.x[]] | length as $n | .y == $n' f.json",
      errorOutput: "jq: error (at f.json:1): Cannot index array with string \"y\"",
      consecutive: 2,
    });
    expect(r.infeasible).toBe(true);
    expect(r.kind).toBe("jq-as-binding-misuse");
  });

  it("flags shell parse errors as infeasible", () => {
    const r = classifyFailure({
      cmd: "echo 'hi", errorOutput: "syntax error: unexpected end of file", consecutive: 2,
    });
    expect(r.infeasible).toBe(true);
    expect(r.kind).toBe("shell-parse-error");
  });

  it("flags missing tools as infeasible (typo or env mismatch)", () => {
    const r = classifyFailure({
      cmd: "yarn build", errorOutput: "yarn: command not found", consecutive: 2,
    });
    expect(r.infeasible).toBe(true);
    expect(r.kind).toBe("missing-tool");
  });

  it("does NOT flag a normal assertion failure as infeasible (false-positive guard)", () => {
    const r = classifyFailure({
      cmd: "test -f foo && grep -q bar foo",
      errorOutput: "false",   // typical jq -e exit-1 with no error message
      consecutive: 5,
    });
    expect(r.infeasible).toBe(false);
  });
});

describe("repair-detector / createFailureTracker", () => {
  it("returns 1 on first record, increments on identical signature", () => {
    const t = createFailureTracker();
    expect(t.record("cmd-A", "err1")).toBe(1);
    expect(t.record("cmd-A", "err1")).toBe(2);
    expect(t.record("cmd-A", "err1")).toBe(3);
  });

  // regression-for: bug
  it("resets count when the error signature changes (different bug = different problem)", () => {
    const t = createFailureTracker();
    t.record("cmd-A", "err1");
    t.record("cmd-A", "err1");
    expect(t.record("cmd-A", "completely different error")).toBe(1);
  });

  it("tracks each cmd independently", () => {
    const t = createFailureTracker();
    t.record("cmd-A", "err");
    t.record("cmd-B", "err");
    t.record("cmd-A", "err");
    expect(t.snapshot()["cmd-A"].count).toBe(2);
    expect(t.snapshot()["cmd-B"].count).toBe(1);
  });

  it("reset() drops a cmd entirely (used after a passing run)", () => {
    const t = createFailureTracker();
    t.record("cmd-A", "err");
    t.record("cmd-A", "err");
    t.reset("cmd-A");
    expect(t.record("cmd-A", "err")).toBe(1);
  });
});

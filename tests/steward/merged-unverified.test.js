// KJC-TSK-1516 — a PR merged before its checks finished (grebla #922).
import { describe, it, expect } from "vitest";
import { VERDICTS, evaluateMergedUnverified, mapStatusCheckRollup } from "../../src/steward/invariants.js";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const pr = (number, mergedAt, checks) => ({ number, mergedAt, checks });
const check = (name, conclusion, completedAt) => ({ name, conclusion, completedAt });
const run = (prs, extra = {}) => evaluateMergedUnverified({ prs, nowMs: NOW, ...extra });

describe("evaluateMergedUnverified", () => {
  it("a check completed after the merge is broken and names the PR", () => {
    const r = run([pr(922, "2026-11-10T10:00:00Z", [check("e2e", "SUCCESS", "2026-11-10T10:05:00Z")])]);
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toContain("#922 (e2e:");
    expect(r.remedy).toContain("branch protection");
  });
  it("a check with no completedAt is broken", () => {
    expect(run([pr(1, "2026-11-10T10:00:00Z", [check("ci", null, null)])]).verdict).toBe(VERDICTS.BROKEN);
  });
  it.each(["FAILURE", "CANCELLED", "TIMED_OUT"])("a %s check is broken", (c) => {
    expect(run([pr(1, "2026-11-10T10:00:00Z", [check("ci", c, "2026-11-10T09:00:00Z")])]).verdict).toBe(VERDICTS.BROKEN);
  });
  it("skipped and neutral checks are fine", () => {
    const checks = [check("a", "SKIPPED", "2026-11-10T09:00:00Z"), check("b", "NEUTRAL", "2026-11-10T09:00:00Z")];
    expect(run([pr(1, "2026-11-10T10:00:00Z", checks)]).verdict).toBe(VERDICTS.OK);
  });
  it("an earlier failed run of a check that was re-run green before the merge is fine", () => {
    const checks = [check("scan", "FAILURE", "2026-11-10T09:00:00Z"), check("scan", "SUCCESS", "2026-11-10T09:30:00Z")];
    expect(run([pr(3786, "2026-11-10T10:00:00Z", checks)]).verdict).toBe(VERDICTS.OK);
  });
  it("a conclusion outside success, neutral and skipped is unverified", () => {
    for (const conclusion of ["ACTION_REQUIRED", "STALE", "STARTUP_FAILURE"]) {
      expect(run([pr(5, "2026-11-10T10:00:00Z", [check("ci", conclusion, "2026-11-10T09:00:00Z")])]).verdict).toBe(VERDICTS.BROKEN);
    }
  });
  it("a read that hit its limit is never ok: older merges may be unseen", () => {
    const green = pr(7, "2026-11-10T10:00:00Z", [check("ci", "SUCCESS", "2026-11-10T09:00:00Z")]);
    expect(run([green], { truncated: true }).verdict).toBe(VERDICTS.NOT_OBSERVABLE);
  });
  it("all green before the merge is ok", () => {
    expect(run([pr(1, "2026-11-10T10:00:00Z", [check("ci", "SUCCESS", "2026-11-10T09:00:00Z")])]).verdict).toBe(VERDICTS.OK);
  });
  it("merges outside the window are ignored", () => {
    const old = pr(1, "2026-10-01T10:00:00Z", [check("ci", "FAILURE", "2026-10-01T09:00:00Z")]);
    const r = run([old]);
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.evidence).toContain("no PR merged");
  });
  it("names at most 3 PRs and the total", () => {
    const prs = [1, 2, 3, 4].map((n) => pr(n, "2026-11-10T10:00:00Z", [check("ci", "FAILURE", "2026-11-10T09:00:00Z")]));
    const r = run(prs);
    expect(r.evidence).toContain("4 ");
    expect(r.evidence).not.toContain("#4 (");
  });
  it("prs null is not-observable with the reason", () => {
    const r = run(null, { reason: "gh failed" });
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.evidence).toContain("gh failed");
  });
});

describe("mapStatusCheckRollup", () => {
  it("maps CheckRun and StatusContext forms", () => {
    const out = mapStatusCheckRollup([
      { name: "ci", conclusion: "SUCCESS", completedAt: "2026-11-10T09:00:00Z" },
      { context: "legacy", state: "PENDING" },
    ]);
    expect(out).toEqual([
      { name: "ci", conclusion: "SUCCESS", completedAt: "2026-11-10T09:00:00Z" },
      { name: "legacy", conclusion: "PENDING", completedAt: null },
    ]);
  });
  it("a terminal StatusContext ends at its startedAt or createdAt", () => {
    const out = mapStatusCheckRollup([
      { context: "a", state: "SUCCESS", startedAt: "2026-11-10T09:00:00Z" },
      { context: "b", state: "SUCCESS", createdAt: "2026-11-10T09:10:00Z" },
    ]);
    expect(out.map((c) => c.completedAt)).toEqual(["2026-11-10T09:00:00Z", "2026-11-10T09:10:00Z"]);
  });
});

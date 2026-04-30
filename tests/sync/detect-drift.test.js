import { describe, expect, it } from "vitest";
import { classifyDrift, formatDriftReport } from "../../src/sync/detect-drift.js";

const PLAN_TIME = new Date("2026-04-29T10:00:00Z");
const BEFORE = new Date(PLAN_TIME.getTime() - 24 * 3600 * 1000);
const AFTER = new Date(PLAN_TIME.getTime() + 24 * 3600 * 1000);

const plan = {
  planId: "plan-test",
  createdAt: PLAN_TIME.toISOString(),
  operations: [
    { title: "Add foo", file_hint: "src/foo.js" },
    { title: "Add bar", file_hint: "src/bar.js" },
  ],
};

describe("classifyDrift", () => {
  it("returns clean when every covered file is unmodified", () => {
    const r = classifyDrift(plan, [
      { path: "src/foo.js", mtime: BEFORE },
      { path: "src/bar.js", mtime: BEFORE },
    ]);
    expect(r.covered).toEqual([]);
    expect(r.untracked).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.clean).toHaveLength(2);
  });

  it("classifies covered+modified as 'covered'", () => {
    const r = classifyDrift(plan, [
      { path: "src/foo.js", mtime: AFTER },
    ]);
    expect(r.covered).toHaveLength(1);
    expect(r.covered[0].operationIndex).toBe(0);
    // bar.js wasn't seen on disk → missing.
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].path).toBe("src/bar.js");
  });

  it("classifies modified-but-not-referenced as 'untracked' (the user added a new file)", () => {
    const r = classifyDrift(plan, [
      { path: "src/foo.js", mtime: BEFORE },
      { path: "src/bar.js", mtime: BEFORE },
      { path: "src/orphan.js", mtime: AFTER },
    ]);
    expect(r.untracked).toHaveLength(1);
    expect(r.untracked[0].path).toBe("src/orphan.js");
    expect(r.untracked[0].suggestion).toMatch(/new operation/i);
  });

  it("classifies plan-referenced-but-missing-from-disk as 'missing'", () => {
    const r = classifyDrift(plan, [
      { path: "src/foo.js", mtime: BEFORE },
      // bar.js intentionally absent
    ]);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].path).toBe("src/bar.js");
    expect(r.missing[0].operationIndex).toBe(1);
  });

  it("ignores pre-existing files not modified since the plan (no false-positive untracked)", () => {
    const r = classifyDrift(plan, [
      { path: "README.md", mtime: BEFORE }, // not in plan, not modified → noise, ignore
    ]);
    expect(r.untracked).toEqual([]);
  });

  it("works with v2 plans (hus[].fileHint key) and Canvas (operations[].file_hint key)", () => {
    const v2Plan = {
      planId: "plan-v2",
      createdAt: PLAN_TIME.toISOString(),
      hus: [{ id: "hu_001", fileHint: "src/legacy.js" }],
    };
    const r = classifyDrift(v2Plan, [{ path: "src/legacy.js", mtime: AFTER }]);
    expect(r.covered).toHaveLength(1);
  });

  it("treats plan with no createdAt as 'all files are post-plan' (worst-case classification)", () => {
    const noTime = { planId: "x", operations: [{ file_hint: "src/x.js" }] };
    const r = classifyDrift(noTime, [{ path: "src/x.js", mtime: AFTER }]);
    expect(r.covered).toHaveLength(1);
  });
});

describe("formatDriftReport", () => {
  it("prints 'No drift detected' when everything is clean", () => {
    const r = classifyDrift(plan, [
      { path: "src/foo.js", mtime: BEFORE },
      { path: "src/bar.js", mtime: BEFORE },
    ]);
    const txt = formatDriftReport(r, plan);
    expect(txt).toContain("No drift detected");
  });

  it("renders covered / untracked / missing sections with counts", () => {
    const r = classifyDrift(plan, [
      { path: "src/foo.js", mtime: AFTER },        // covered
      { path: "src/orphan.js", mtime: AFTER },      // untracked
      // src/bar.js missing
    ]);
    const txt = formatDriftReport(r, plan);
    expect(txt).toContain("Covered (1)");
    expect(txt).toContain("Untracked (1)");
    expect(txt).toContain("Missing (1)");
  });
});

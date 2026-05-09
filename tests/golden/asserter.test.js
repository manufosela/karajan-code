import { describe, expect, it } from "vitest";
import { parseSummary, assertFromSummary } from "../../src/golden/asserter.js";

const baseTask = {
  id: "todo", title: "x", prompt: "y",
  expected_commits_min: 2, expected_audit_status: "pass",
  expected_test_files: [], allowed_loc_range: [0, 999],
};

const summary = (extras = "") => `# Session summary — s-1

- **Result**: ✅ APPROVED

## Stages

| Stage | Status | Summary |
|---|---|---|
| \`coder\` | ✅ pass | 3 files |
| \`audit\` | ✅ pass | clean |

## Commits

- \`abc1234\` feat: add login
- \`def4567\` test: login e2e
- \`9876543\` chore: tidy

${extras}
## Journal files

- [iterations.md](./iterations.md)
`;

describe("golden/asserter — parseSummary", () => {
  it("extracts commits, audit status and plan adherence score", () => {
    const md = summary("## Plan adherence\n\n**Score**: 87/100\n\n");
    const r = parseSummary(md);
    expect(r.commits.map((c) => c.hash)).toEqual(["abc1234", "def4567", "9876543"]);
    expect(r.auditStatus).toBe("pass");
    expect(r.planAdherenceScore).toBe(87);
  });

  it("returns null planAdherenceScore when section is missing", () => {
    expect(parseSummary(summary()).planAdherenceScore).toBeNull();
  });

  it("returns empty commits when summary says 'No commits'", () => {
    const md = "## Commits\n\n_No commits in this session._\n\n## Journal files";
    expect(parseSummary(md).commits).toEqual([]);
  });

  it("returns null auditStatus when audit row is missing", () => {
    expect(parseSummary("# random").auditStatus).toBeNull();
  });

  it("recognises ❌ fail and ⚠ warning audit cells", () => {
    const fail = parseSummary("| `audit` | ❌ fail | broken |").auditStatus;
    const warn = parseSummary("| `audit` | ⚠ warning | flaky |").auditStatus;
    expect(fail).toBe("fail");
    expect(warn).toBe("warning");
  });
});

describe("golden/asserter — assertFromSummary", () => {
  it("returns ok=true when every assertion passes", () => {
    const md = summary("## Plan adherence\n\n**Score**: 90/100\n\n");
    const parsed = parseSummary(md);
    const r = assertFromSummary({ ...baseTask, expected_plan_adherence_min: 75 }, parsed);
    expect(r).toEqual({ ok: true, failures: [] });
  });

  it("flags commits_min when below threshold", () => {
    const md = "## Stages\n| `audit` | ✅ pass | ok |\n## Commits\n- `a` x\n## Journal";
    const r = assertFromSummary(baseTask, parseSummary(md));
    expect(r.ok).toBe(false);
    expect(r.failures.find((f) => f.kind === "commits_min")).toBeTruthy();
  });

  it("flags audit_status mismatch including the 'no audit row' case", () => {
    const r = assertFromSummary({ ...baseTask, expected_audit_status: "fail" }, parseSummary(summary()));
    expect(r.failures.find((f) => f.kind === "audit_status")).toMatchObject({ expected: "fail", actual: "pass" });
    const noAudit = assertFromSummary(baseTask, parseSummary("## Commits\n- `a` x\n- `b` y\n## Journal"));
    expect(noAudit.failures.find((f) => f.kind === "audit_status")).toMatchObject({ actual: null });
  });

  it("flags plan_adherence_below and plan_adherence_missing distinctly", () => {
    const below = assertFromSummary(
      { ...baseTask, expected_plan_adherence_min: 80 },
      parseSummary(summary("## Plan adherence\n\n**Score**: 60/100\n\n")),
    );
    expect(below.failures.find((f) => f.kind === "plan_adherence_below")).toMatchObject({ actual: 60 });
    const missing = assertFromSummary(
      { ...baseTask, expected_plan_adherence_min: 70 },
      parseSummary(summary()),
    );
    expect(missing.failures.find((f) => f.kind === "plan_adherence_missing")).toBeTruthy();
  });

  it("skips plan_adherence assertion when the task did not declare a threshold", () => {
    const r = assertFromSummary(baseTask, parseSummary(summary()));
    expect(r.failures.some((f) => f.kind.startsWith("plan_adherence"))).toBe(false);
  });
});

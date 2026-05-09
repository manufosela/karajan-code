import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runGoldenTask } from "../../src/golden/runner.js";

const baseTask = {
  id: "todo", title: "x", prompt: "Build todo",
  timeout_minutes: 5,
  expected_commits_min: 2, expected_audit_status: "pass",
  expected_test_files: ["tests/todo.test.js"], allowed_loc_range: [50, 250],
};

const okSummary = `## Stages
| Stage | Status | Summary |
| \`audit\` | ✅ pass | clean |
## Commits
- \`a\` feat: x
- \`b\` test: y
- \`c\` chore: z
## Plan adherence
**Score**: 92/100
## Journal`;

describe("golden/runner — runGoldenTask", () => {
  let tmp;

  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-runner-")); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

  function setupFiles({ summary, testFile = true } = {}) {
    const summaryPath = path.join(tmp, "summary.md");
    return Promise.all([
      summary !== undefined ? fs.writeFile(summaryPath, summary) : Promise.resolve(),
      testFile ? fs.mkdir(path.join(tmp, "tests"), { recursive: true })
        .then(() => fs.writeFile(path.join(tmp, "tests/todo.test.js"), "")) : Promise.resolve(),
    ]).then(() => summaryPath);
  }

  it("returns ok=true when every assertion passes", async () => {
    const summaryPath = await setupFiles({ summary: okSummary });
    // 60 + 40 = 100 LOC, within [50, 250]
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "60\t0\ta.js\n40\t0\tb.js\n", stderr: "" });
    const r = await runGoldenTask(baseTask, { workDir: tmp, summaryPath, run, baseSha: "abc" });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.parsed.commits).toHaveLength(3);
  });

  it("returns no_summary when kj produced none and findLatestSummary fails", async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 1, stdout: "", stderr: "boom" });
    const r = await runGoldenTask(baseTask, { workDir: tmp, run });
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe("no_summary");
    expect(r.kjExit).toBe(1);
  });

  it("flags test_files_missing when an expected test file is absent", async () => {
    const summaryPath = await setupFiles({ summary: okSummary, testFile: false });
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const r = await runGoldenTask(baseTask, { workDir: tmp, summaryPath, run });
    expect(r.failures.find((f) => f.kind === "test_files_missing")).toMatchObject({
      actual: ["tests/todo.test.js"],
    });
  });

  it("flags loc_out_of_range when total added LOC falls outside the bounds", async () => {
    const summaryPath = await setupFiles({ summary: okSummary });
    // numstat says 5 lines added — below the [50,250] range.
    const run = vi.fn().mockImplementation((cmd, args) => {
      if (args?.[0] === "diff") return Promise.resolve({ exitCode: 0, stdout: "5\t0\tfoo.js\n", stderr: "" });
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    });
    const r = await runGoldenTask(baseTask, { workDir: tmp, summaryPath, run, baseSha: "abc" });
    expect(r.failures.find((f) => f.kind === "loc_out_of_range")).toMatchObject({ actual: 5 });
  });

  it("ignores LOC range when no baseSha is provided", async () => {
    const summaryPath = await setupFiles({ summary: okSummary });
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const r = await runGoldenTask(baseTask, { workDir: tmp, summaryPath, run });
    expect(r.failures.find((f) => f.kind === "loc_out_of_range")).toBeUndefined();
  });

  it("propagates summary-derived failures (commits_min)", async () => {
    const summaryPath = await setupFiles({
      summary: "## Stages\n| `audit` | ✅ pass | ok |\n## Commits\n- `a` x\n## Journal",
    });
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const r = await runGoldenTask(baseTask, { workDir: tmp, summaryPath, run });
    expect(r.failures.find((f) => f.kind === "commits_min")).toBeTruthy();
  });

  it("rejects when workDir is missing", async () => {
    await expect(runGoldenTask(baseTask, {})).rejects.toThrow(/workDir/);
  });
});

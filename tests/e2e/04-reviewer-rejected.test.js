/**
 * E2E #04 — `kj run --plan <id>` with a reviewer that always rejects.
 *
 * Spec: tests/e2e spec ("FASE 1") §4.
 *
 * Setup:
 *   - Plan with one HU whose acceptance_tests fail (shell: `false`),
 *     forcing the pipeline to invoke the reviewer instead of the
 *     fast-path "tests passed → approved".
 *   - Fake reviewer returns `{approved: false, blocking_issues: [...]}`
 *     deterministically.
 *   - Coder always succeeds (its work is irrelevant — the test is the
 *     reviewer-rejection / max-iterations path).
 *
 * Asserts:
 *   - exit code 0 (the run completes; max-iterations is a soft fail)
 *   - the HU ends up in `failed` (not a zombie `coding`)
 *   - no `ReferenceError` (regression for the saveSession / generateDiff
 *     missing-import bug class — those previously crashed the rejection
 *     path with a Node-level exception)
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runKj } from "./helpers/spawn-kj.js";
import { makeTmpProject } from "./helpers/tmp-project.js";

const SPEC = fs.readFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures/plans/minimal-spec.md"),
  "utf8"
);

function makeFixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kj-e2e-fixture-"));
}

function readPlanFile(kjHome) {
  const slugRoot = path.join(kjHome, "plans");
  const slugs = fs.readdirSync(slugRoot);
  const plansDir = path.join(slugRoot, slugs[0]);
  const planFiles = fs.readdirSync(plansDir).filter(f => f.endsWith(".json"));
  const planPath = path.join(plansDir, planFiles[0]);
  return { planId: path.basename(planFiles[0], ".json"), planPath, plan: JSON.parse(fs.readFileSync(planPath, "utf8")) };
}

describe("e2e/04 — reviewer rejected → HU fails (no ReferenceError)", () => {
  let proj, fixtureDir;
  afterEach(() => {
    try { proj?.cleanup(); } catch { /* */ }
    try { if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("after max_iterations the HU is failed and no ReferenceError leaked", () => {
    proj = makeTmpProject({ spec: SPEC, prefix: "kj-e2e-04-" });
    fixtureDir = makeFixtureDir();

    // 1-HU plan with a failing acceptance test, forcing the reviewer path.
    const planner = JSON.stringify({
      approach: "force reviewer path",
      steps: [
        { description: "fail-only", commit: "feat: x", spec_section: "1", acceptance_tests: ["false"] }
      ],
      risks: [], outOfScope: []
    });
    const reviewerRejection = JSON.stringify({
      approved: false,
      blocking_issues: [{
        id: "I-1", severity: "high", file: "x.js", line: 1,
        description: "fake rejection", suggested_fix: "fix it"
      }],
      non_blocking_suggestions: [],
      summary: "rejected by fake reviewer",
      confidence: 0.9
    });
    fs.writeFileSync(path.join(fixtureDir, "coder-script.json"), JSON.stringify({
      planner: { output: planner },
      reviewer: { output: reviewerRejection },
      "hu-reviewer": { output: reviewerRejection }
    }));

    const gen = runKj(
      ["plan", "generate", "--task-file", "SPEC.md", "-y", "--planner", "fake", "--no-preflight-hu"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 60_000 }
    );
    expect(gen.exitCode, `gen stderr: ${gen.stderr}`).toBe(0);

    const { planId, planPath } = readPlanFile(proj.kjHome);
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    for (const h of plan.hus) h.status = "certified";
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

    const run = runKj(
      ["run", "--plan", planId, "-y",
        "--coder", "fake", "--reviewer", "fake", "--planner", "fake",
        "--task-type", "doc", "--max-iterations", "1"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 80_000 }
    );

    // Regression sentinel: the rejection path used to crash with
    // `ReferenceError: saveSession is not defined` because the import
    // was missing. The run still succeeded as a process (exit 0) but
    // the stderr/stdout would carry the trace — assert it's gone.
    const all = `${run.stdout}\n${run.stderr}`;
    expect(all, "ReferenceError leaked into output (saveSession / generateDiff bug class regressed)").not.toMatch(/ReferenceError/);

    // The exit code should be 0 — the run as a process completes;
    // max-iterations is a soft outcome, not a process error.
    expect(run.exitCode).toBe(0);

    const after = JSON.parse(fs.readFileSync(planPath, "utf8"));
    const hu = after.hus[0];
    // KJC-TSK-0403: tras max_iterations la HU debe terminar en pending+result=fail
    // o blocked (status/result ortogonal). NUNCA en coding/reviewing (zombi).
    expect(["pending", "blocked"]).toContain(hu.status);
    if (hu.status === "pending") expect(hu.result).toBe("fail");
    expect(hu.status).not.toBe("coding");
    expect(hu.status).not.toBe("reviewing");
  }, 90_000);
});

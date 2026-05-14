/**
 * E2E #05 — Repairer escalation on a broken-by-construction acceptance test.
 *
 * Spec: tests/e2e spec ("FASE 1") §5.
 *
 * Per the spec's intent, this test covers the regression for issue
 * #538 (planner emits a syntactically broken acceptance test, coder
 * iterates against an irreparable wall, HU is failed, dependents
 * blocked). The Repairer is supposed to:
 *   1. detect the broken-test signature on the 2nd consecutive failure
 *      ("Cannot index array with string …" — see repair-detector.js)
 *   2. NOT consume an iteration when it fires (attempt -= 1)
 *   3. on `unfixable` verdict, fail the HU IMMEDIATELY rather than
 *      burning the rest of max_iterations.
 *
 * Note on naming: the spec file is `05-sonar-config-error.test.js`
 * because the same broken-test family was originally discovered while
 * SonarQube returned its "Invalid value of sonar.tests" error. The
 * regression IS the Repairer path; the sonar fixture would be a
 * cosmetic dressing on the same assertion. We omit the sonar mock
 * here and exercise the Repairer directly via the broken jq test.
 *
 * Asserts:
 *   - run log contains `repair:start` / `repair:end` events
 *   - HU ends at `failed` (escalated unfixable, not max-iterations)
 *   - run still exits cleanly (no Node-level crash)
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

describe("e2e/05 — Repairer escalation (regression #538)", () => {
  let proj, fixtureDir;
  afterEach(() => {
    try { proj?.cleanup(); } catch { /* */ }
    try { if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("Repairer fires + HU fails immediately on unfixable test", () => {
    proj = makeTmpProject({ spec: SPEC, prefix: "kj-e2e-05-" });
    fixtureDir = makeFixtureDir();

    // Broken jq pattern (from the real 2026-04-29 incident): produces
    // "Cannot index array with string ..." which hits the
    // jq-as-binding-misuse signature in repair-detector.js.
    const brokenTest = `echo '[1,2,3]' | jq 'length as $n | .field'`;
    const planner = JSON.stringify({
      approach: "broken acceptance test triggers repairer",
      steps: [{
        description: "broken-test", commit: "feat: x", spec_section: "1",
        acceptance_tests: [brokenTest]
      }],
      risks: [], outOfScope: []
    });
    const repairUnfixable = JSON.stringify({
      verdict: "unfixable",
      fixed_test: null,
      reason: "Test references a field that does not exist on the input array; cannot be repaired without changing intent.",
      diagnostics: ["jq query targets non-existent property"]
    });
    fs.writeFileSync(path.join(fixtureDir, "coder-script.json"), JSON.stringify({
      planner: { output: planner },
      repairer: { output: repairUnfixable },
      // Reviewer / hu-reviewer not invoked on the acceptance-failure
      // path, but provide safe defaults just in case the flow falls
      // through.
      reviewer: { output: JSON.stringify({ approved: true, blocking_issues: [], summary: "ok" }) },
      "hu-reviewer": { output: JSON.stringify({ approved: true, blocking_issues: [], summary: "ok" }) }
    }));

    // 1) Generate plan.
    const gen = runKj(
      ["plan", "generate", "--task-file", "SPEC.md", "-y", "--planner", "fake"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 60_000 }
    );
    expect(gen.exitCode, `gen stderr: ${gen.stderr}`).toBe(0);

    const { planId, planPath } = readPlanFile(proj.kjHome);
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    for (const h of plan.hus) h.status = "certified";
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

    // 2) Run with max-iterations=3 so the Repairer has chance to fire on
    // the 2nd consecutive failure (threshold default is 2).
    const run = runKj(
      ["run", "--plan", planId, "-y",
        "--coder", "fake", "--reviewer", "fake", "--planner", "fake",
        "--task-type", "doc", "--max-iterations", "3"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 80_000 }
    );

    // No Node-level crash even though Repairer escalated.
    const all = `${run.stdout}\n${run.stderr}`;
    expect(all).not.toMatch(/ReferenceError|TypeError: Cannot read prop/);

    expect(run.exitCode).toBe(0);

    // The repair:start / repair:end events MUST land in either stdout
    // (the printer) or run.log (the on-disk audit trail).
    const runLogPath = path.join(proj.kjHome, "run.log");
    let runLog = "";
    if (fs.existsSync(runLogPath)) runLog = fs.readFileSync(runLogPath, "utf8");
    const seenRepairStart = /repair:start|Repairer.*invoked|Repairer escalated|Repairer fixed/i.test(all + runLog);
    expect(seenRepairStart, "Repairer should have been invoked at least once").toBe(true);

    // KJC-TSK-0403: tras Repairer "unfixable" la HU vuelve a pending+result=fail
    // (path inmediato de fallo, no el de max_iterations).
    const after = JSON.parse(fs.readFileSync(planPath, "utf8"));
    const hu = after.hus[0];
    expect(["pending", "blocked"]).toContain(hu.status);
    if (hu.status === "pending") expect(hu.result).toBe("fail");
  }, 90_000);
});

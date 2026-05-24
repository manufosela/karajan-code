/**
 * E2E #03 — `kj run --plan <id> --hu <huId>` runs a single HU.
 *
 * Spec: tests/e2e spec ("FASE 1") §3.
 *
 * Regression for the 2026-04-27 zombie-status bug
 * (src/orchestrator/hu-sub-pipeline.js::needsSubPipeline). Pre-fix, a
 * single-HU launch fell through to the standard single-task pipeline,
 * which never persisted "done"/"failed" anywhere — board kanban
 * showed "1 running…" indefinitely. The fix changed the predicate
 * from `> 1` to `>= 1`. This test pins that path: the named HU must
 * end at `done` and the on-disk plan must reflect it.
 *
 * Asserts:
 *   - only the named HU moves to `done`
 *   - other HUs stay at their pre-run status (`certified`)
 *   - on-disk batch + plan persistence still work for single-HU path
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

describe("e2e/03 — kj run --plan --hu <huId> single HU", () => {
  let proj, fixtureDir;
  afterEach(() => {
    try { proj?.cleanup(); } catch { /* */ }
    try { if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("only the named HU moves to done; the others stay certified", () => {
    proj = makeTmpProject({ spec: SPEC, prefix: "kj-e2e-03-" });
    fixtureDir = makeFixtureDir();
    const planner = JSON.stringify({
      approach: "single-hu",
      steps: [
        { description: "first", commit: "feat: 1", spec_section: "1", acceptance_tests: ["true"] },
        { description: "second", commit: "feat: 2", spec_section: "2", acceptance_tests: ["true"] },
        { description: "third", commit: "feat: 3", spec_section: "3", acceptance_tests: ["true"] },
      ],
      risks: [], outOfScope: []
    });
    fs.writeFileSync(path.join(fixtureDir, "coder-script.json"),
      JSON.stringify({ planner: { output: planner } }));

    const gen = runKj(
      ["plan", "generate", "--task-file", "SPEC.md", "-y", "--planner", "fake", "--no-preflight-hu"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 60_000 }
    );
    expect(gen.exitCode, `gen stderr: ${gen.stderr}`).toBe(0);

    const { planId, planPath } = readPlanFile(proj.kjHome);
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    for (const h of plan.hus) h.status = "certified";
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
    expect(plan.hus.length).toBeGreaterThanOrEqual(2);

    const targetHu = plan.hus[0].id;
    const otherHus = plan.hus.slice(1).map(h => h.id);

    const run = runKj(
      ["run", "--plan", planId, "--hu", targetHu, "-y",
        "--coder", "fake", "--reviewer", "fake", "--planner", "fake",
        "--task-type", "doc", "--max-iterations", "1"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 80_000 }
    );
    if (run.exitCode !== 0) {
      console.error("[03] stderr tail:", run.stderr.slice(-2000));
    }
    expect(run.exitCode).toBe(0);

    const after = JSON.parse(fs.readFileSync(planPath, "utf8"));
    const target = after.hus.find(h => h.id === targetHu);
    expect(target.status, `target HU ${targetHu} did not reach done — zombie status regression?`).toBe("done");

    for (const id of otherHus) {
      const other = after.hus.find(h => h.id === id);
      // Other HUs must not have been touched.
      expect(other.status, `other HU ${id} should not have moved`).toBe("certified");
    }
  }, 90_000);
});

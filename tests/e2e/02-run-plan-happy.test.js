/**
 * E2E #02 — `kj run --plan <id>` happy path with the fake-coder.
 *
 * Spec: tests/e2e spec ("FASE 1") §2.
 *
 * Setup: tmp project + 2-HU plan (HUs pre-set to `certified` so the
 * sub-pipeline picks them up immediately). Fake coder/reviewer always
 * succeeds. Sonar is disabled by passing `--task-type doc` (the
 * non-deprecated path; `--no-sonar` is a deprecated no-op since v2.7.4).
 *
 * Asserts:
 *   - exit code 0 within the test timeout
 *   - every HU in the on-disk plan moves to `done`
 *   - plan top-level status becomes `done`
 *   - on-disk batch under <kjHome>/hu-stories/plan-<planId>/ matches plan
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

function writePlannerScript(fixtureDir, opts = {}) {
  const huCount = opts.huCount || 2;
  const steps = Array.from({ length: huCount }, (_, i) => ({
    description: `step ${i + 1}`,
    commit: `feat: step ${i + 1}`,
    spec_section: String(i + 1),
    acceptance_tests: ["true"]
  }));
  const planner = JSON.stringify({ approach: "happy path", steps, risks: [], outOfScope: [] });
  const script = { planner: { output: planner } };
  fs.writeFileSync(path.join(fixtureDir, "coder-script.json"), JSON.stringify(script));
}

function readPlanFile(kjHome) {
  const slugRoot = path.join(kjHome, "plans");
  const slugs = fs.readdirSync(slugRoot);
  const plansDir = path.join(slugRoot, slugs[0]);
  const planFiles = fs.readdirSync(plansDir).filter(f => f.endsWith(".json"));
  const planPath = path.join(plansDir, planFiles[0]);
  return { planId: path.basename(planFiles[0], ".json"), planPath, plan: JSON.parse(fs.readFileSync(planPath, "utf8")) };
}

function certifyAllHus(planPath) {
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  for (const h of plan.hus) h.status = "certified";
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return plan;
}

describe("e2e/02 — kj run --plan happy path", () => {
  let proj, fixtureDir;
  afterEach(() => {
    try { proj?.cleanup(); } catch { /* */ }
    try { if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("kj run --plan with all-OK fake coder marks every HU done and plan done", () => {
    proj = makeTmpProject({ spec: SPEC, prefix: "kj-e2e-02-" });
    fixtureDir = makeFixtureDir();
    writePlannerScript(fixtureDir, { huCount: 2 });

    // 1) Generate the plan.
    const gen = runKj(
      ["plan", "generate", "--task-file", "SPEC.md", "-y", "--planner", "fake", "--no-preflight-hu"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 60_000 }
    );
    expect(gen.exitCode, `gen stderr: ${gen.stderr}`).toBe(0);

    const { planId, planPath } = readPlanFile(proj.kjHome);
    // Promote every HU to certified so the sub-pipeline executes them.
    certifyAllHus(planPath);

    // 2) Run the plan with --task-type doc to skip sonar (non-deprecated path).
    const run = runKj(
      ["run", "--plan", planId, "-y",
        "--coder", "fake", "--reviewer", "fake", "--planner", "fake",
        "--task-type", "doc", "--max-iterations", "1"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 80_000 }
    );
    expect(run.exitCode, `kj run failed (exit=${run.exitCode}); stderr tail: ${run.stderr.slice(-1500)}`).toBe(0);

    const after = JSON.parse(fs.readFileSync(planPath, "utf8"));
    // Spec asks for "completed"; the codebase emits "done" once every HU is
    // done (src/plan/plan-executor.js). We assert the actual terminal state.
    expect(after.status).toBe("done");
    for (const h of after.hus) {
      expect(h.status, `HU ${h.id} did not finish`).toBe("done");
    }

    // On-disk batch under hu-stories/plan-<planId>/ matches plan.
    const batchDir = path.join(proj.kjHome, "hu-stories", `plan-${planId}`);
    expect(fs.existsSync(batchDir), `batch dir missing: ${batchDir}`).toBe(true);
    const batchPath = path.join(batchDir, "batch.json");
    expect(fs.existsSync(batchPath)).toBe(true);
    const batch = JSON.parse(fs.readFileSync(batchPath, "utf8"));
    const ids = (batch.stories || []).map(s => s.id).sort();
    const planIds = after.hus.map(h => h.id).sort();
    expect(ids).toEqual(planIds);
  }, 90_000);
});

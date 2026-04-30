/**
 * E2E #02 — `kj plan list` and `kj plan show` against pre-seeded plans.
 *
 * No LLM call: we drop a hand-crafted plan JSON into KJ_HOME and
 * assert the read-only commands surface it correctly. Pins the
 * plan-store path resolution + the rendering layer.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runKj } from "./helpers/spawn-kj.js";
import { makeTmpProject } from "./helpers/tmp-project.js";

function seedPlan(kjHome, projectDir, planId, plan) {
  // The slug is derived from projectDir in src/plan/plan-store.js. Easiest
  // way to guarantee a match is to actually call the slug helper, but for
  // a black-box test we replicate the heuristic: strip leading /, replace
  // separators with _.
  const slug = projectDir.replace(/^\//, "").replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 120);
  const dir = path.join(kjHome, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${planId}.json`), JSON.stringify(plan, null, 2));
  return dir;
}

describe("e2e/02 — kj plan list / show", () => {
  let proj;
  afterEach(() => proj?.cleanup());

  it("kj plan list lists a seeded plan", () => {
    proj = makeTmpProject();
    seedPlan(proj.kjHome, proj.projectDir, "plan-test-001", {
      planId: "plan-test-001",
      version: 2,
      task: "do X",
      status: "ready",
      projectDir: proj.projectDir,
      hus: [{ id: "hu_test_001", title: "Do X", status: "certified", blocked_by: [] }],
    });

    const r = runKj(["plan", "list"], { cwd: proj.projectDir });
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toContain("plan-test-001");
  });

  it("kj plan show <planId> prints the plan's HUs", () => {
    proj = makeTmpProject();
    seedPlan(proj.kjHome, proj.projectDir, "plan-test-002", {
      planId: "plan-test-002",
      version: 2,
      task: "do Y",
      status: "ready",
      projectDir: proj.projectDir,
      hus: [
        { id: "hu_test_002_a", title: "Step A", status: "certified", blocked_by: [] },
        { id: "hu_test_002_b", title: "Step B", status: "certified", blocked_by: ["hu_test_002_a"] },
      ],
    });

    const r = runKj(["plan", "show", "plan-test-002"], { cwd: proj.projectDir });
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
    // Each HU title appears in the output.
    expect(r.stdout).toContain("Step A");
    expect(r.stdout).toContain("Step B");
  });

  it("kj plan show <unknown-id> exits non-zero with a clear message", () => {
    proj = makeTmpProject();
    const r = runKj(["plan", "show", "plan-does-not-exist-123"], { cwd: proj.projectDir });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/not found|no encontrado/i);
  });
});

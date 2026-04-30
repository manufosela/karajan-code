/**
 * E2E #03 — `kj plan validate` and `kj plan ready` against pre-seeded plans.
 * No LLM call.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runKj } from "./helpers/spawn-kj.js";
import { makeTmpProject } from "./helpers/tmp-project.js";

function seedPlan(kjHome, projectDir, planId, plan) {
  const slug = projectDir.replace(/^\//, "").replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 120);
  const dir = path.join(kjHome, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${planId}.json`), JSON.stringify(plan, null, 2));
  return path.join(dir, `${planId}.json`);
}

describe("e2e/03 — kj plan validate / ready", () => {
  let proj;
  afterEach(() => proj?.cleanup());

  it("kj plan validate <id> on a well-formed plan exits 0", () => {
    proj = makeTmpProject();
    seedPlan(proj.kjHome, proj.projectDir, "plan-valid-001", {
      planId: "plan-valid-001",
      version: 2,
      task: "do X",
      status: "ready",
      projectDir: proj.projectDir,
      hus: [{ id: "hu_v_001", title: "Do X", status: "certified", blocked_by: [], acceptance_tests: ["true"] }],
    });
    const r = runKj(["plan", "validate", "plan-valid-001"], { cwd: proj.projectDir });
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
  });

  it("kj plan ready <id> moves status from draft → ready (idempotent)", () => {
    proj = makeTmpProject();
    const planFile = seedPlan(proj.kjHome, proj.projectDir, "plan-draft-001", {
      planId: "plan-draft-001",
      version: 2,
      task: "do X",
      status: "draft",
      projectDir: proj.projectDir,
      hus: [
        { id: "hu_d_001", title: "Do X", status: "certified", blocked_by: [], acceptance_tests: ["true"] },
      ],
    });
    const r = runKj(["plan", "ready", "plan-draft-001"], { cwd: proj.projectDir });
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);

    const after = JSON.parse(fs.readFileSync(planFile, "utf8"));
    expect(after.status).toBe("ready");

    // Re-running is a no-op (idempotent).
    const again = runKj(["plan", "ready", "plan-draft-001"], { cwd: proj.projectDir });
    expect(again.exitCode).toBe(0);
  });

  it("kj plan validate on a non-existent planId exits non-zero", () => {
    proj = makeTmpProject();
    const r = runKj(["plan", "validate", "plan-does-not-exist"], { cwd: proj.projectDir });
    expect(r.exitCode).not.toBe(0);
  });
});

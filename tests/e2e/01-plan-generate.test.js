/**
 * E2E #01 — `kj plan generate` end-to-end with the fake-coder planner.
 *
 * Spec: tests/e2e spec ("FASE 1") §1.
 *
 * Setup: tmp project with a minimal SPEC.md, fake planner (no real
 * LLM call). The fake-coder is registered via NODE_OPTIONS --import
 * before kj.js runs, so `--planner fake` resolves to it.
 *
 * Asserts:
 *   - exit code 0
 *   - a plan JSON exists under <kjHome>/plans/<projectSlug>/plan-*.json
 *   - the JSON parses, has task, hus[], status in {draft, ready}
 *     (kj plan generate emits "draft"; we then call kj plan ready and
 *     re-assert that it flipped to "ready" — covering the spec's
 *     literal status: "ready" requirement)
 *   - the printed planId matches the file basename
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

describe("e2e/01 — kj plan generate", () => {
  let proj, fixtureDir;
  afterEach(() => {
    try { proj?.cleanup(); } catch { /* */ }
    try { if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("kj plan generate produces a valid plan JSON and prints planId", () => {
    proj = makeTmpProject({ spec: SPEC, prefix: "kj-e2e-01-" });
    fixtureDir = makeFixtureDir();

    // Three-HU planner output: spec asserts hus[] is non-trivial.
    const plannerOutput = {
      approach: "Implement greeting endpoint, language toggle, and access log.",
      steps: [
        { description: "Add GET /hello endpoint", commit: "feat: add /hello", spec_section: "1", acceptance_tests: ["true"] },
        { description: "Support ?lang query", commit: "feat: lang toggle", spec_section: "2", acceptance_tests: ["true"] },
        { description: "Log every request", commit: "feat: access log", spec_section: "3", acceptance_tests: ["true"] }
      ],
      risks: ["thread safety on log writes"],
      outOfScope: ["authentication"]
    };
    fs.writeFileSync(
      path.join(fixtureDir, "coder-script.json"),
      JSON.stringify({ planner: { output: JSON.stringify(plannerOutput) } })
    );

    const r = runKj(
      ["plan", "generate", "--task-file", "SPEC.md", "-y", "--planner", "fake", "--no-preflight-hu"],
      { cwd: proj.projectDir, fakeAgent: true, fixtureDir, timeoutMs: 60_000 }
    );
    if (r.exitCode !== 0) {
      console.error("[01] stdout:", r.stdout);
      console.error("[01] stderr:", r.stderr);
    }
    expect(r.exitCode).toBe(0);

    // Locate plan JSON under <kjHome>/plans/<slug>/plan-*.json.
    const slugRoot = path.join(proj.kjHome, "plans");
    const slugs = fs.readdirSync(slugRoot);
    expect(slugs.length, `no project slug under ${slugRoot}`).toBeGreaterThan(0);
    const planFiles = fs.readdirSync(path.join(slugRoot, slugs[0])).filter(f => f.endsWith(".json"));
    expect(planFiles.length).toBeGreaterThan(0);

    const planPath = path.join(slugRoot, slugs[0], planFiles[0]);
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));

    // Spec contract: task, hus[], status.
    expect(plan).toHaveProperty("task");
    expect(Array.isArray(plan.hus)).toBe(true);
    expect(plan.hus.length).toBeGreaterThanOrEqual(1);
    expect(["draft", "ready"]).toContain(plan.status);

    // Printed planId matches file basename.
    const planId = path.basename(planFiles[0], ".json");
    expect(r.stdout).toContain(planId);

    // Now flip draft → ready and re-assert the spec's literal status.
    if (plan.status === "draft") {
      const ready = runKj(["plan", "ready", planId], {
        cwd: proj.projectDir, timeoutMs: 30_000
      });
      expect(ready.exitCode, `ready stderr: ${ready.stderr}`).toBe(0);
      const after = JSON.parse(fs.readFileSync(planPath, "utf8"));
      expect(after.status).toBe("ready");
    }
  }, 90_000);
});

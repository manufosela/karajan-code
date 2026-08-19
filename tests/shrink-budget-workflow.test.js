// Structural test for .github/workflows/shrink-budget.yml.
//
// The workflow itself is shell + GitHub Actions, not testable as a unit.
// What we CAN test is that the YAML parses, has the two expected jobs,
// keeps the env-level LOC_LIMIT switch, and preserves the label-based
// opt-out ("large-pr-justified", "new-dep-approved"). These are the
// pieces that, if accidentally renamed or removed, would silently disable
// the budget guard.
//
// Source: KJC-TSK-0352 / GitHub issue #573 (audit 2026-05-03 finding #3).

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = resolve(__dirname, "../.github/workflows/shrink-budget.yml");

async function loadWorkflow() {
  const raw = await readFile(WORKFLOW_PATH, "utf8");
  return yaml.load(raw);
}

describe("shrink-budget workflow", () => {
  it("parses as valid YAML", async () => {
    const wf = await loadWorkflow();
    expect(wf).toBeTypeOf("object");
    expect(wf.name).toBe("Shrink Budget");
  });

  it("triggers on pull_request to main", async () => {
    const wf = await loadWorkflow();
    // js-yaml parses YAML's `on:` as boolean true (1.1 quirk). Either key
    // is acceptable as long as exactly one of them maps to the trigger.
    const onKey = "on" in wf ? "on" : true;
    const trigger = wf[onKey] ?? wf.on;
    expect(trigger?.pull_request?.branches).toContain("main");
  });

  it("reads LOC_LIMIT from the policy file, fail-loud, and exports it across steps (PL-C)", async () => {
    const wf = await loadWorkflow();
    // Single source of thresholds: the limit lives in .karajan/policy.yml,
    // not in a workflow env — the gate extracts it and refuses to guess.
    expect(wf.env?.KJ_POLICY_FILE).toBe(".karajan/policy.yml");
    expect(wf.env?.LOC_LIMIT).toBeUndefined();
    const run = wf.jobs["loc-budget"].steps.find((s) => s.id === "loc").run;
    expect(run).toContain("loc-budget");
    expect(run).toMatch(/refuses to guess.*exit 1/s);
    expect(run).toContain('echo "LOC_LIMIT=$LOC_LIMIT" >> "$GITHUB_ENV"');
  });

  it("defines exactly the two expected jobs", async () => {
    const wf = await loadWorkflow();
    const jobNames = Object.keys(wf.jobs ?? {});
    expect(jobNames.sort()).toEqual(["loc-budget", "new-deps-warning"]);
  });

  it("loc-budget job has the large-pr-justified label opt-out", async () => {
    const wf = await loadWorkflow();
    const ifClause = wf.jobs["loc-budget"].if ?? "";
    expect(ifClause).toContain("large-pr-justified");
    expect(ifClause).toContain("contains(github.event.pull_request.labels.*.name");
  });

  it("new-deps-warning job has the new-dep-approved label opt-out", async () => {
    const wf = await loadWorkflow();
    const ifClause = wf.jobs["new-deps-warning"].if ?? "";
    expect(ifClause).toContain("new-dep-approved");
  });

  it("both jobs checkout with full history (fetch-depth: 0)", async () => {
    const wf = await loadWorkflow();
    for (const jobName of ["loc-budget", "new-deps-warning"]) {
      const steps = wf.jobs[jobName].steps ?? [];
      const checkout = steps.find((s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout"));
      expect(checkout, `${jobName} must have a checkout step`).toBeDefined();
      expect(checkout.with?.["fetch-depth"], `${jobName} checkout must use fetch-depth: 0`).toBe(0);
    }
  });

  it("loc-budget enforces the limit by failing (exit 1) when net > LOC_LIMIT", async () => {
    const raw = await readFile(WORKFLOW_PATH, "utf8");
    // The enforcement step uses bash. We assert the exit-1 contract is
    // present so a future cleanup that turns the gate into a soft warning
    // would have to remove this token (and we'd catch it).
    expect(raw).toMatch(/exit\s+1/);
    expect(raw).toContain("Net LOC delta is");
  });
});

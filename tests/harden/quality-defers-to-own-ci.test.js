// HU-4621 (issue #4611, ADR 0065): a repo whose own CI already runs its tests keeps that CI as its
// quality gate; kj harden adds no kj-quality workflow there and removes the managed one it finds.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkHarden } from "../../src/harden/check.js";
import { ownTestWorkflow } from "../../src/harden/test-on-push.js";
import { installWorkflows, plannedQualityBody } from "../../src/harden/workflow-engine.js";

let dir;
const WF = join(".github", "workflows");
const quality = join(WF, "kj-quality.yml");
const roots = [{ dir: ".", language: "javascript" }];
const writeWorkflow = (name, body) => {
  mkdirSync(join(dir, WF), { recursive: true });
  writeFileSync(join(dir, WF, name), body);
};
const OWN_CI = "name: CI\non: pull_request\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run typecheck\n      - run: npm test\n";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-quality-defers-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run" } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ownTestWorkflow (HU-4621)", () => {
  it("names the repo's own workflow that runs the tests, never a kj-* one", () => {
    writeWorkflow("kj-quality.yml", "steps:\n  - run: npm test\n");
    expect(ownTestWorkflow(dir)).toBeNull();
    writeWorkflow("ci.yml", OWN_CI);
    expect(ownTestWorkflow(dir)).toBe("ci.yml");
  });

  it("is null when the repo's own workflows run no tests, or there are none", () => {
    expect(ownTestWorkflow(dir)).toBeNull();
    writeWorkflow("deploy.yml", "steps:\n  - run: npm run build\n");
    expect(ownTestWorkflow(dir)).toBeNull();
  });
});

describe("kj harden leaves the quality gate to the repo's own CI (HU-4621)", () => {
  it("installs no kj-quality workflow and says which workflow it defers to", () => {
    writeWorkflow("ci.yml", OWN_CI);
    const res = installWorkflows({ projectDir: dir, language: "javascript", roots });
    expect(existsSync(join(dir, quality))).toBe(false);
    expect(res.workflows.find((w) => w.file === quality)).toMatchObject({ action: "deferred", note: expect.stringContaining("ci.yml") });
    expect(plannedQualityBody(dir, roots)).toBeNull();
  });

  it("removes the managed kj-quality workflow an earlier kj harden wrote", () => {
    installWorkflows({ projectDir: dir, language: "javascript", roots });
    expect(existsSync(join(dir, quality))).toBe(true);
    writeWorkflow("ci.yml", OWN_CI);
    const dry = installWorkflows({ projectDir: dir, language: "javascript", roots, dryRun: true });
    expect(dry.workflows.find((w) => w.file === quality)).toMatchObject({ action: "removed" });
    expect(existsSync(join(dir, quality))).toBe(true);
    const res = installWorkflows({ projectDir: dir, language: "javascript", roots });
    expect(res.workflows.find((w) => w.file === quality)).toMatchObject({ action: "removed", note: expect.stringContaining("ci.yml") });
    expect(existsSync(join(dir, quality))).toBe(false);
  });

  it("never removes a kj-quality.yml the repo wrote itself", () => {
    writeWorkflow("ci.yml", OWN_CI);
    writeWorkflow("kj-quality.yml", "name: mine\n");
    installWorkflows({ projectDir: dir, language: "javascript", roots });
    expect(readFileSync(join(dir, quality), "utf8")).toBe("name: mine\n");
  });

  it("kj check misses no kj-quality in a repo whose own CI runs the tests", async () => {
    writeWorkflow("ci.yml", OWN_CI);
    const { checks } = await checkHarden({ projectDir: dir });
    expect(checks.find((c) => c.id === "workflow:kj-quality.yml")).toBeUndefined();
  });

  it("keeps installing kj-quality where the repo has no CI of its own running tests", () => {
    writeWorkflow("deploy.yml", "steps:\n  - run: npm run build\n");
    installWorkflows({ projectDir: dir, language: "javascript", roots });
    expect(readFileSync(join(dir, quality), "utf8")).toContain("kj:managed:wf-quality");
  });
});

// HU-4645 (KJC-BUG-0641): where the repo's own CI runs its tests kj harden drops kj-quality (ADR
// 0065), but a base branch that still requires the quality check would then block every PR waiting
// for a check nobody publishes. kj harden keeps kj-quality while a required check holds it.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { baseBranchRequiredChecks, requiredContexts } from "../../src/harden/branch-protection.js";
import { installWorkflows } from "../../src/harden/workflow-engine.js";

let dir;
const WF = join(".github", "workflows");
const quality = join(WF, "kj-quality.yml");
const roots = [{ dir: ".", language: "javascript" }];
const OWN_CI = "name: CI\non: pull_request\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
const harden = (requiredChecks) => installWorkflows({ projectDir: dir, language: "javascript", roots, requiredChecks });
const qualityResult = (res) => res.workflows.find((w) => w.file === quality);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-quality-held-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run" } }));
  harden(undefined);
  mkdirSync(join(dir, WF), { recursive: true });
  writeFileSync(join(dir, WF, "ci.yml"), OWN_CI);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("kj harden keeps kj-quality while the base branch requires its check (HU-4645)", () => {
  it("keeps the managed kj-quality and names the required check that holds it", () => {
    const res = harden(new Set(["scan", "quality"]));
    expect(existsSync(join(dir, quality))).toBe(true);
    expect(qualityResult(res).action).not.toBe("removed");
    expect(qualityResult(res).note).toMatch(/ci\.yml.*quality/);
  });

  it("writes kj-quality back when a required check needs it and it is gone", () => {
    rmSync(join(dir, quality));
    harden(new Set(["quality"]));
    expect(existsSync(join(dir, quality))).toBe(true);
  });

  it("keeps it when the protection could not be read", () => {
    expect(qualityResult(harden(null)).note).toMatch(/could not be read/);
    expect(existsSync(join(dir, quality))).toBe(true);
  });

  // HU-4663 (#4661): the person's kj harden --commit runs where gh may not read the protection the
  // agent's kj harden read; an unreadable protection keeps a kj-quality, it never creates one.
  it("does not create it when the protection could not be read and it is gone", () => {
    rmSync(join(dir, quality));
    expect(qualityResult(harden(null)).action).toBe("deferred");
    expect(existsSync(join(dir, quality))).toBe(false);
  });

  it("removes it once no required check holds it (ADR 0065)", () => {
    expect(qualityResult(harden(new Set(["scan"]))).action).toBe("removed");
    expect(existsSync(join(dir, quality))).toBe(false);
  });
});

describe("requiredContexts (HU-4645)", () => {
  const reply = (byPath) => async (_cmd, args) => byPath(args[1]);
  const target = { owner: "o", repo: "r", branch: "main" };

  it("joins the classic contexts and the ruleset checks", async () => {
    const run = reply((p) => (p.endsWith("/protection")
      ? { exitCode: 0, stdout: JSON.stringify({ required_status_checks: { contexts: ["quality"] } }) }
      : { exitCode: 0, stdout: JSON.stringify([{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "scan" }] } }]) }));
    expect(await requiredContexts({ ...target, run })).toEqual(new Set(["quality", "scan"]));
  });

  it("is empty for a branch with no protection and no rulesets", async () => {
    const run = reply(() => ({ exitCode: 1, stderr: "HTTP 404: Branch not protected" }));
    expect(await requiredContexts({ ...target, run })).toEqual(new Set());
  });

  it("is null when the protection cannot be read", async () => {
    const run = reply(() => ({ exitCode: 1, stderr: "HTTP 403: Resource not accessible" }));
    expect(await requiredContexts({ ...target, run })).toBeNull();
  });
});

describe("baseBranchRequiredChecks (HU-4645)", () => {
  const origin = (url, api) => async (cmd, args) => (cmd === "git" ? { exitCode: 0, stdout: `${url}\n` } : api(args[1]));
  const identity = () => {};

  it("reads nothing for an origin outside GitHub", async () => {
    const run = origin("https://gitlab.com/o/r.git", () => { throw new Error("no gh call expected"); });
    expect(await baseBranchRequiredChecks({ projectDir: dir, branch: "main", run, identity })).toBeUndefined();
  });

  it("reads the GitHub base branch's required checks", async () => {
    const run = origin("git@github.com:o/r.git", (p) => (p === "repos/o/r/branches/main/protection"
      ? { exitCode: 0, stdout: JSON.stringify({ required_status_checks: { contexts: ["quality"] } }) }
      : { exitCode: 0, stdout: "[]" }));
    expect(await baseBranchRequiredChecks({ projectDir: dir, branch: "main", run, identity })).toEqual(new Set(["quality"]));
  });

  it("is null when the clone's account does not hold", async () => {
    const run = origin("git@github.com:o/r.git", () => ({ exitCode: 0, stdout: "{}" }));
    const wrongAccount = () => { throw new Error("gh is not the clone's account"); };
    expect(await baseBranchRequiredChecks({ projectDir: dir, branch: "main", run, identity: wrongAccount })).toBeNull();
  });
});

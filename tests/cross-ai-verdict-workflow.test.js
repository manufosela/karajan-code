// KJC-TSK-1113: structural test for .github/workflows/cross-ai-verdict.yml, the
// pieces that, renamed or removed, would silently stop proving the verdicts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";

const wf = yaml.load(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.github/workflows/cross-ai-verdict.yml"), "utf8"));
const job = wf.jobs.verdicts;

describe("cross-ai-verdict workflow", () => {
  it("runs on every push to a PR and again when a review is published", () => {
    expect(wf.on.pull_request.types).toEqual(expect.arrayContaining(["opened", "synchronize", "reopened"]));
    expect(wf.on.pull_request_review.types).toEqual(["submitted"]);
  });

  it("checks out the whole history and runs kj review --verify-pr on the PR, read-only", () => {
    expect(wf.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(job.steps[0].with["fetch-depth"]).toBe(0);
    const verify = job.steps.find((s) => String(s.run ?? "").includes("--verify-pr"));
    // KJC-BUG-0399: the judge is the base branch's kj, never the PR's own.
    expect(verify.run).toContain('node "$RUNNER_TEMP/kj-judge/bin/kj.js" review --verify-pr');
    expect(verify.env.GH_TOKEN).toContain("github.token");
  });

  it("checks out the base branch's kj apart, from a base ref every trigger carries", () => {
    const judge = job.steps.find((s) => String(s.run ?? "").includes("git worktree add"));
    expect(judge.env.BASE_REF).toBe("${{ github.event.pull_request.base.ref }}");
    expect(judge.run).toContain('git fetch --no-tags origin "${BASE_REF}:refs/remotes/origin/${BASE_REF}"');
    expect(judge.run).toContain('git worktree add --detach "$RUNNER_TEMP/kj-judge" "origin/${BASE_REF}"');
  });

  it("pins every action to a commit sha", () => {
    for (const s of job.steps.filter((x) => x.uses)) expect(s.uses).toMatch(/@[0-9a-f]{40}\b/);
  });
});

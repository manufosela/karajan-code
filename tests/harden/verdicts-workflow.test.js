import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installWorkflows } from "../../src/harden/workflow-engine.js";
import { verdictsWorkflowFor } from "../../src/harden/workflow-templates.js";

// HU-4012: every hardened repo checks in CI that each PR commit has its published cross-AI verdict.
describe("verdictsWorkflowFor", () => {
  const text = verdictsWorkflowFor("9.9.9", "karajan-code");
  const parsed = yaml.load(text);
  const job = parsed.jobs.verdicts;

  it("reruns on every PR push and on every submitted review (the verdict is published as one)", () => {
    expect(parsed.on).toEqual({ pull_request: { types: ["opened", "synchronize", "reopened"] }, pull_request_review: { types: ["submitted"] } });
    expect(parsed.permissions).toEqual({ contents: "read", "pull-requests": "read" });
  });

  it("only judges the repo's own branches and non-bot authors", () => {
    expect(job.if).toBe("github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.type != 'Bot'");
  });

  it("the judge is the base branch's kj or the pinned published kj, never the PR's code nor @latest", () => {
    const run = job.steps.at(-1).run;
    expect(run).toContain('git cat-file -e "origin/${BASE_REF}:bin/kj.js"');
    expect(run).toContain('git worktree add --detach "$JUDGE" "origin/${BASE_REF}"');
    expect(run).toContain("npm install --no-save --ignore-scripts --no-audit --no-fund karajan-code@9.9.9");
    expect(run).toContain('$KJ review --verify-pr "$PR"');
    expect(run).not.toMatch(/node bin\/kj\.js|@latest/);
    expect(job.steps.at(-1).env).toEqual({ BASE_REF: "${{ github.event.pull_request.base.ref }}", PR: "${{ github.event.pull_request.number }}", GH_TOKEN: "${{ github.token }}" });
    expect(job.steps[0].with).toEqual({ "fetch-depth": 0 });
  });
});

describe("installWorkflows: kj-verdicts.yml", () => {
  let dir;
  const verdicts = (res) => res.workflows.find((w) => w.file.endsWith("kj-verdicts.yml"));
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-verdicts-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("is written on a fresh repo and unchanged on a second run", () => {
    expect(verdicts(installWorkflows({ projectDir: dir, kjVersion: "9.9.9" }))).toEqual({ file: join(".github", "workflows", "kj-verdicts.yml"), action: "inserted" });
    expect(readFileSync(join(dir, ".github", "workflows", "kj-verdicts.yml"), "utf8")).toContain("kj:managed:wf-verdicts");
    expect(verdicts(installWorkflows({ projectDir: dir, kjVersion: "9.9.9" })).action).toBe("unchanged");
  });

  // No other workflow's text decides whether the repo enforces verdicts: kj-verdicts.yml is
  // written as every kj workflow is, beside the repo's own verify-pr workflow too.
  it("is written beside a repo's own verify-pr workflow too, with no note", () => {
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "cross-ai-verdict.yml"), "name: x\njobs:\n  v:\n    steps:\n      - run: node bin/kj.js review --verify-pr \"$PR\"\n");
    expect(verdicts(installWorkflows({ projectDir: dir, kjVersion: "9.9.9" }))).toEqual({ file: join(".github", "workflows", "kj-verdicts.yml"), action: "inserted" });
    expect(readFileSync(join(dir, ".github", "workflows", "kj-verdicts.yml"), "utf8")).toContain("kj:managed:wf-verdicts");
  });
});

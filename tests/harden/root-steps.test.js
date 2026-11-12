import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hookBody } from "../../src/harden/hook-templates.js";
import { rootLintSteps, rootTestSteps } from "../../src/harden/root-steps.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const log = (who) => `echo ${who} >> "$KJ_LOG"`;
const TWO_ROOTS = {
  roots: [
    { dir: ".", language: "typescript", lint: log("root"), format: log("root-fmt"), test: log("root-test") },
    { dir: "apps/mobile", language: "python", lint: log('mobile "$PWD"'), test: log("mobile-test") },
    { dir: "android", language: "gradle" },
  ],
};

describe("HU-4036: a single root renders the hooks of today", () => {
  const py = { lint: "ruff check .", format: "ruff format --check .", test: "pytest" };
  it.each([
    ["pre-commit", py, "0aa8684f75a401aa38a43c20708897764204ca00bf140103d300120b612d8203"],
    ["pre-push", py, "99b4cdfc5eb4853ccfa772c738885ccf332684695a6d1f26945f529d226ff5ca"],
    ["pre-push", { testSkippedByCi: true }, "8580cc5b70411cadd9cc36969c7d6e63de57e0e77ad6e87af946ca37148e8489"],
  ])("%s %j is byte-identical", (hook, cmds, golden) => expect(sha(hookBody(hook, cmds, { baseBranch: "main" }))).toBe(golden));
});

describe("HU-4036: the rendered steps of a multi-root repo", () => {
  it("each root is guarded by its own paths, runs from its dir, and says when it has no commands", () => {
    const body = hookBody("pre-commit", TWO_ROOTS);
    expect(body).toContain("if kj_staged_touches ':(literal).' ':(exclude,literal)apps/mobile' ':(exclude,literal)android'; then");
    expect(body).toContain("if kj_staged_touches ':(literal)apps/mobile'; then\n  (\n    cd 'apps/mobile'");
    expect(body).toContain("# android (gradle): no lint/format command for this stack root");
    expect(hookBody("pre-push", TWO_ROOTS)).toContain("# android (gradle): no test command for this stack root");
  });

  it("a pinned step replaces the per-root steps of its kind", () => {
    const body = hookBody("pre-commit", { lint: "my-lint", ...TWO_ROOTS });
    expect(body).toContain("my-lint || { echo 'kj harden: lint failed'; exit 1; }");
    expect(body).not.toContain("echo mobile ");
    expect(body).toContain(log("root-fmt"));
    expect(hookBody("pre-push", { test: "my-test", ...TWO_ROOTS })).not.toContain(log("mobile-test"));
  });

  it("CI running the tests drops them for the whole repo", () => {
    const roots = TWO_ROOTS.roots.map((r) => ({ ...r, test: undefined }));
    expect(hookBody("pre-push", { roots, testSkippedByCi: true })).toContain("# Tests run in CI on each PR, not on push.");
  });
});

describe("HU-4036: the generated steps against a real repo", () => {
  let repo;
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
  const stage = (...rels) => {
    for (const rel of rels) {
      mkdirSync(join(repo, rel, ".."), { recursive: true });
      writeFileSync(join(repo, rel), rel);
    }
    git("add", "-A");
  };
  const run = (lines, env = {}) => {
    const out = join(repo, ".kjlog");
    execFileSync("sh", ["-c", ["set -e", ...lines].join("\n")], { cwd: repo, env: { ...process.env, KJ_LOG: out, ...env } });
    return existsSync(out) ? readFileSync(out, "utf8").trim().split("\n") : [];
  };
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kj-roots-"));
    git("init", "-q", "-b", "main");
    stage("README.md", "apps/mobile/x.py", "android/a.kt");
    git("commit", "-qm", "base");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("a change staged only under apps/mobile runs only its step, from its dir", () => {
    stage("apps/mobile/with space.py");
    expect(run(rootLintSteps(TWO_ROOTS))).toEqual([`mobile ${repo}/apps/mobile`]);
  });

  it("a change staged only at the root runs only the root's steps", () => {
    stage("src/a b.ts");
    expect(run(rootLintSteps(TWO_ROOTS))).toEqual(["root", "root-fmt"]);
  });

  it("pre-push tests only the roots its new commits touch", () => {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    stage("apps/mobile/y.py");
    git("commit", "-qm", "mobile");
    const refs = `refs/heads/main ${git("rev-parse", "HEAD")} refs/heads/main ${git("rev-parse", "HEAD~1")}`;
    expect(run(['kj_push_refs="$REFS"', ...rootTestSteps(TWO_ROOTS)], { REFS: refs })).toEqual(["mobile-test"]);
  });
});

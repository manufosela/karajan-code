import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { privacyScanCommand } from "../../src/commands/privacy.js";
import { installWorkflows } from "../../src/harden/workflow-engine.js";
import { secretsWorkflowFor } from "../../src/harden/workflow-templates.js";

// HU-4144 (HU-4013 step b): every hardened repo scans each PR's added lines for credentials in CI.
describe("secretsWorkflowFor", () => {
  const text = secretsWorkflowFor("9.9.9", "karajan-code");
  const parsed = yaml.load(text);
  const job = parsed.jobs.secrets;
  const step = job.steps.at(-1);

  // As kj-policy.yml (KJC-BUG-0419): on pull_request a PR runs its own copy of this YAML.
  it("runs the base's YAML on every PR push, read-only and without secrets", () => {
    expect(parsed.on).toEqual({ pull_request_target: { types: ["opened", "synchronize", "reopened"] } });
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(text).not.toMatch(/\$\{\{\s*secrets\.|GH_TOKEN/);
    expect(text).toMatch(/# .*pull_request_target.*event policy.*kj-policy\.yml/);
  });

  it("only scans the repo's own branches and non-bot authors", () => {
    expect(job.if).toBe("github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.type != 'Bot'");
  });

  it("the judge is the base branch's kj or the pinned published kj, never the PR's code nor @latest", () => {
    expect(step.run).toContain('git cat-file -e "origin/${BASE_REF}:bin/kj.js"');
    expect(step.run).toContain('git worktree add --detach "$JUDGE" "origin/${BASE_REF}"');
    expect(step.run).toContain("npm install --no-save --ignore-scripts --no-audit --no-fund karajan-code@9.9.9");
    expect(step.run).not.toMatch(/node bin\/kj\.js|@latest/);
    expect(job.steps[0].with).toEqual({ "fetch-depth": 0 });
    expect(job.steps[1].with).toEqual({ "node-version": 22 });
  });

  it("fetches the base and the PR head, then scans the range up to the PR head", () => {
    expect(step.env).toEqual({ BASE_REF: "${{ github.base_ref }}", PR_NUMBER: "${{ github.event.pull_request.number }}" });
    expect(step.run).not.toContain("${{");
    const lines = step.run.trim().split("\n");
    expect(lines.slice(1, 3)).toEqual([
      'git fetch --no-tags origin "${BASE_REF}:refs/remotes/origin/${BASE_REF}"',
      'git fetch --no-tags origin "+refs/pull/${PR_NUMBER}/head:refs/remotes/origin/kj-pr-head"',
    ]);
    expect(lines.at(-1)).toBe('$KJ privacy scan --range "origin/${BASE_REF}...origin/kj-pr-head"');
  });

  // The PR is only git objects: no tree of it on disk, so its files never steer the scan.
  it("never checks out, installs nor runs anything of the PR", () => {
    const lines = step.run.trim().split("\n");
    expect(lines.filter((l) => l.includes("kj-pr-head"))).toHaveLength(2);
    expect(lines.filter((l) => /\bnpm (ci|install)\b/.test(l)).every((l) => l.trim().startsWith('(cd "$JUDGE" && '))).toBe(true);
    expect(step.run).not.toMatch(/^\s*cd |git (checkout|switch)\b/m);
  });

  it("says that CI has no personal denylist: only credentials block there", () => {
    expect(text).toMatch(/# .*~\/\.karajan\/privacy\.yml/);
  });
});

describe("installWorkflows: kj-secrets.yml", () => {
  let dir;
  const secrets = (res) => res.workflows.find((w) => w.file.endsWith("kj-secrets.yml"));
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-secrets-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("is written on a fresh repo and unchanged on a second run", () => {
    expect(secrets(installWorkflows({ projectDir: dir, kjVersion: "9.9.9" }))).toEqual({ file: join(".github", "workflows", "kj-secrets.yml"), action: "inserted" });
    expect(readFileSync(join(dir, ".github", "workflows", "kj-secrets.yml"), "utf8")).toContain("kj:managed:wf-secrets");
    expect(secrets(installWorkflows({ projectDir: dir, kjVersion: "9.9.9" })).action).toBe("unchanged");
  });
});

// Inside a tree of the PR, its own .gitattributes (-diff) and .karajan/kj.config.yml
// (non_secret_assignments) would hide its credentials from git diff and from the guard.
describe("kj-secrets.yml's scan, run where the workflow runs it (the base's checkout)", () => {
  let repo;
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, stdio: "pipe" });
  const commit = (message, files) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), text);
    }
    git("add", ".");
    git("commit", "-qm", message);
  };
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kj-secrets-run-"));
    process.env.KJ_PRIVACY_CONFIG = join(repo, "no-privacy.yml");
  });
  afterEach(() => {
    delete process.env.KJ_PRIVACY_CONFIG;
    process.exitCode = undefined;
    rmSync(repo, { recursive: true, force: true });
  });

  it("a PR cannot hide its credentials with its own .gitattributes or kj config", async () => {
    git("init", "-q", "-b", "main");
    commit("base", { "README.md": "base\n" });
    git("switch", "-q", "-c", "pr");
    commit("pr", {
      ".gitattributes": "src/pay.js -diff\n",
      ".karajan/kj.config.yml": 'guards:\n  output:\n    non_secret_assignments: ["src/db.js:dbPasswordToken"]\n',
      "src/pay.js": `const k = "sk_live_${"a1B2c3D4".repeat(3)}";\n`,
      // Composed at runtime, like the key above, so the fixture holds no secret-shaped literal.
      "src/db.js": `const dbPasswordToken = "${"a1B2c3".repeat(3)}";\n`,
    });
    git("switch", "-q", "main");
    git("update-ref", "refs/remotes/origin/main", "main");
    git("update-ref", "refs/remotes/origin/kj-pr-head", "pr");
    const run = yaml.load(secretsWorkflowFor("9.9.9")).jobs.secrets.steps.at(-1).run;
    const range = /privacy scan --range "([^"]+)"/.exec(run)[1].replaceAll("${BASE_REF}", "main");
    const out = [];
    const log = (m) => out.push(m);
    await privacyScanCommand({ flags: { range }, cwd: repo, logger: { error: log, warn: log, info: log } });
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toMatch(/\[stripe-key\] src\/pay\.js:1/);
    expect(out.join("\n")).toMatch(/\[hardcoded-key-assignment\] src\/db\.js:1/);
  });
});

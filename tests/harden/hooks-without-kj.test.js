// HU-3530: the hooks of kj apply only to a person who has kj installed. Without kj on PATH the
// kj-only checks skip with a visible notice and never block; with kj they behave as before.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookBody } from "../../src/harden/hook-templates.js";
import { fakeKjPath, SYSTEM_PATH } from "./_fake-kj.js";

// PATH is only the system tools (git, sh, grep, sed...), so "no kj" is real; a fake kj that always
// fails goes first on the PATH for the "kj present" cases.
let repo;
let noKjBin;
let failingKjBin;
const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo });
const preCommit = (bin) => spawnSync("sh", ["-c", hookBody("pre-commit", {})], {
  cwd: repo, encoding: "utf8", env: { PATH: bin, HOME: repo, GIT_CONFIG_GLOBAL: "/dev/null" },
});
const stage = (file, text = "x\n") => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
  git("add", "-f", file);
};
const output = (res) => `${res.stdout}${res.stderr}`;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-no-kj-"));
  // No template: a machine-wide git template would put its own hooks in .git/hooks, and the generated hook chains them.
  git("init", "-q", "-b", "main", "--template=");
  noKjBin = SYSTEM_PATH;
  failingKjBin = fakeKjPath(repo, { exitCode: 1 });
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("pre-commit without kj on PATH", () => {
  it("(a) a staged kj.config.yml skips the secret check with a notice and continues", () => {
    stage(".karajan/kj.config.yml", "sonarqube:\n  host: h\n");
    const res = preCommit(noKjBin);
    expect(output(res)).toMatch(/kj\.config\.yml.*skipped.*kj is not installed/);
    expect(res.status).toBe(0);
  });

  it("(b) a committed review gate skips with a notice and continues", () => {
    stage(".karajan/review-gate", "");
    git("commit", "-q", "--no-verify", "-m", "chore: gate");
    stage("f.js", "// change\n");
    const res = preCommit(noKjBin);
    expect(res.status).toBe(0);
    expect(output(res)).toMatch(/review gate.*skipped.*kj is not installed/);
  });

  it("(c) the identity advisory prints only when kj is present", () => {
    expect(output(preCommit(noKjBin))).not.toMatch(/no identity declared/);
    expect(output(preCommit(failingKjBin))).toMatch(/no identity declared/);
  });

  it("(e) the checks that do not need kj still block", () => {
    // Built at runtime: the literal would trip this very repo's attribution guard on commit.
    stage("notes.md", `${["Co-Authored", "By"].join("-")}: Claude\n`);
    const res = preCommit(noKjBin);
    expect(res.status).toBe(1);
    expect(output(res)).toMatch(/AI attribution/);
  });
});

describe("pre-commit with kj on PATH keeps blocking", () => {
  it("(d) a kj that rejects the staged kj.config.yml blocks", () => {
    stage(".karajan/kj.config.yml", "sonarqube:\n  host: h\n");
    const res = preCommit(failingKjBin);
    expect(res.status).toBe(1);
    expect(output(res)).toMatch(/keep tokens and passwords out/);
  });

  it("(d) a kj with no approved verdict blocks on the committed review gate", () => {
    stage(".karajan/review-gate", "");
    git("commit", "-q", "--no-verify", "-m", "chore: gate");
    stage("f.js", "// change\n");
    const res = preCommit(failingKjBin);
    expect(res.status).toBe(1);
    expect(output(res)).toMatch(/no approved cross-AI verdict/);
  });
});

// KJC-TSK-0769 — policy at the effect boundary: kj release check re-evaluates
// everything since the last tag against the policy IN FORCE now.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runReleaseCheck } from "../../src/checks/release-check.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const commit = (rel, msg) => { write(rel, "x\n"); git("add", rel); git("commit", "-qm", msg); };
const policy = async () => (await runReleaseCheck({ projectDir: dir, config: {} })).checks.find((c) => c.name === "policy");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-relpol-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  write("package.json", JSON.stringify({ name: "demo", version: "1.1.0", private: true }));
  write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-08-21\n\n- stuff\n");
  write(".karajan/policy.yml", "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\ninvariants:\n  - id: loc-budget\n    kind: diff-threshold\n    metric: net_lines_added\n    max: 1\n    enforcement: deny\n");
  git("add", "-A"); git("commit", "-qm", "base");
  git("tag", "v1.0.0");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("release check — policy at the effect boundary", () => {
  it("RED with the rule and file when a commit since the last tag violates a deny rule of the CURRENT policy", async () => {
    commit("prod.secret", "oops");
    const c = await policy();
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/v1\.0\.0\.\.HEAD/);
    expect(c.detail).toContain("roles.coder.write.deny");
    expect(c.detail).toContain("prod.secret");
  });

  it("green names the range; diff-threshold invariants are PR-scoped and SKIPPED, saying so", async () => {
    commit("src/big.js", "feature");
    const c = await policy();
    expect(c.ok).toBe(true);
    expect(c.detail).toMatch(/v1\.0\.0\.\.HEAD clean/);
    expect(c.detail).toMatch(/1 diff-threshold invariant\(s\) skipped/);
  });

  it("without a previous tag the whole history is evaluated and the detail says so", async () => {
    git("tag", "-d", "v1.0.0");
    commit("prod.secret", "oops");
    const c = await policy();
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/whole history/);
  });

  it("an invalid policy.yml is RED, never a silent pass", async () => {
    write(".karajan/policy.yml", "version: 1\nroles:\n  coder:\n    write: { allw: ['x'] }\n");
    const c = await policy();
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/invalid/);
  });
});

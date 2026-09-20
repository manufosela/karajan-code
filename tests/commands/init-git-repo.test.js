// KJC-BUG-0187 — kj init in a directory that is not a repo used to skip the
// whole harness (no hooks, no Sentinel, no core.hooksPath) behind a buried
// info line, and still close with "✓ Karajan is set up". The guarantees do not
// exist without git, so init creates the repo, exactly like kj run already does.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureGitRepo } from "../../src/commands/init.js";

let dir;
const logger = { info() {}, warn() {}, error() {} };
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-initgit-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj init × git", () => {
  it("creates the repository when the directory has none", () => {
    expect(ensureGitRepo({ projectDir: dir, logger })).toBe(true);
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
  });

  it("leaves an existing repository untouched", () => {
    execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: dir });
    expect(ensureGitRepo({ projectDir: dir, logger })).toBe(true);
    const branch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    expect(branch).toBe("trunk");
  });

  it("reports failure instead of pretending, when git cannot run", () => {
    const boom = () => { throw new Error("git: command not found"); };
    expect(ensureGitRepo({ projectDir: dir, logger, gitFn: boom })).toBe(false);
  });
});

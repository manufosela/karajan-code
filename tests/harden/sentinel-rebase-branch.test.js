// KJC-BUG-0475 (#3125): during a rebase HEAD is detached, `git rev-parse --abbrev-ref HEAD`
// says HEAD, and the card-first gate denied the very edit that resolves the conflict. The
// Sentinel now judges the branch being rebased.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("../../src/harden/sentinel/sentinel-lib.mjs", import.meta.url));
const PROBE = "const m = await import(process.argv[1]); console.log(m.branchOf(process.argv[2]));";
const branchOf = (dir) => execFileSync(process.execPath, ["--input-type=module", "-e", PROBE, LIB, dir], { encoding: "utf8" }).trim();

describe("sentinel branchOf during a rebase — KJC-BUG-0475", () => {
  let repo;
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-rebase-")));
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.txt"), "base\n");
    git("add", "a.txt");
    git("commit", "-qm", "base");
    git("switch", "-qc", "feat/KJC-TSK-0001-x");
    fs.writeFileSync(path.join(repo, "a.txt"), "mine\n");
    git("commit", "-qam", "mine");
    git("switch", "-q", "main");
    fs.writeFileSync(path.join(repo, "a.txt"), "theirs\n");
    git("commit", "-qam", "theirs");
    git("switch", "-q", "feat/KJC-TSK-0001-x");
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("names the branch outside a rebase, and the branch being rebased while it stops on a conflict", () => {
    expect(branchOf(repo)).toBe("feat/KJC-TSK-0001-x");
    expect(() => git("rebase", "main")).toThrow();
    expect(git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("HEAD");
    expect(branchOf(repo)).toBe("feat/KJC-TSK-0001-x");
  });

  it("a detached HEAD with no rebase stays HEAD", () => {
    git("switch", "-q", "--detach", "main");
    expect(branchOf(repo)).toBe("HEAD");
  });
});

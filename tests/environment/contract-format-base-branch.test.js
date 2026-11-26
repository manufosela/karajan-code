// KJC-BUG-0669 (HU-4914), field case: kj harden ran on the base branch, where kj never commits,
// and returned the files to commit by hand BEFORE formatting them. The repo's pre-commit runs
// prettier --check, so the unformatted SKILL.md kj wrote refused every commit after it.
// The prettier here is a double in node_modules/.bin: it marks each file it is given.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { commitContract } from "../../src/environment/contract-commit.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const onDisk = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const fakePrettier = (body) => {
  write("node_modules/.bin/prettier", `#!/bin/sh\n${body}\n`);
  fs.chmodSync(path.join(dir, "node_modules/.bin/prettier"), 0o755);
};
const MARKING = 'seen=0; for f in "$@"; do if [ "$seen" = 1 ]; then echo "formatted" >> "$f"; fi; [ "$f" = "--" ] && seen=1; done; exit 0';
const SKILL = ".claude/skills/working-with-karajan/SKILL.md";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-contract-base-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
  write(".gitignore", "node_modules/\n");
  write("AGENTS.md", "# rules\n");
  git("add", ".gitignore", "AGENTS.md");
  git("commit", "-q", "-m", "chore: init");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("on the base branch the generated files are formatted all the same (KJC-BUG-0669)", () => {
  it("formats what kj generated, commits nothing and still names the files to commit on a branch", () => {
    fakePrettier(MARKING);
    write(SKILL, "# skill\n");
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/on the base branch 'main'/);
    expect(res.files).toEqual([SKILL]);
    expect(onDisk(SKILL)).toBe("# skill\nformatted\n");
    expect(git("diff", "--cached", "--name-only").trim()).toBe("");
  });

  it("a file that was dirty before kj ran keeps the person's bytes", () => {
    fakePrettier(MARKING);
    write("AGENTS.md", "# rules, edited by the person\n");
    write(SKILL, "# skill\n");
    const res = commitContract({ projectDir: dir, before: new Set(["AGENTS.md"]) });
    expect(res.files).toEqual([SKILL]);
    expect(onDisk("AGENTS.md")).toBe("# rules, edited by the person\n");
    expect(onDisk(SKILL)).toBe("# skill\nformatted\n");
  });

  it("a prettier that fails names its own line and the way to commit on a branch", () => {
    fakePrettier("echo '[error] SKILL.md: SyntaxError' >&2; exit 2");
    write(SKILL, "# skill\n");
    const res = commitContract({ projectDir: dir });
    expect(res.committed).toBe(false);
    expect(res.reason).toMatch(/the repo's prettier could not format.*\[error\] SKILL\.md: SyntaxError/);
    expect(res.reason).toMatch(/on a branch yourself/);
  });

  it("nothing generated: nothing to format, nothing to commit", () => {
    fakePrettier(MARKING);
    expect(commitContract({ projectDir: dir }).reason).toBe("nothing of the contract to commit");
  });
});

// BOOT-A step 2 (KJC-TSK-0857) — the contract commit. project-new.md asked the
// USER for it, and it was the commit their own freshly installed gates rejected
// (KJC-BUG-0165 exempted the review gate, KJC-BUG-0186 the branch guard). kj
// makes it itself now: only the files kj generated, only while the repo has no
// commit, and never the person's own code.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { bootstrapCommand } from "../../src/commands/bootstrap.js";

let dir;
const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
// The installers are mocked: what matters here is what gets COMMITTED.
const contract = () => {
  write(".karajan/kj.config.yml", "coder: claude\n");
  write(".karajan/review-gate", "x\n");
  write("CLAUDE.md", "# method\n");
};
const run = (over = {}) => bootstrapCommand({
  config: { projectDir: dir },
  logger: over.logger ?? quiet(),
  flags: {},
  deps: { init: vi.fn(async () => { contract(); return {}; }), env: vi.fn(async () => ({})), ...over.deps },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-bootc-"));
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"], { encoding: "utf8" });
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj bootstrap × the contract commit", () => {
  it("commits what kj generated, and nothing the person wrote", async () => {
    write("src/app.js", "// mine\n");
    const result = await run();
    expect(result.steps.map((s) => s.name)).toContain("contract");
    const committed = git("show", "--name-only", "--format=", "HEAD").trim().split("\n").sort();
    expect(committed).toContain(".karajan/review-gate");
    expect(committed).toContain("CLAUDE.md");
    expect(committed).not.toContain("src/app.js");
    expect(git("status", "--porcelain", "--", "src/app.js")).toMatch(/src\/app\.js/);
  });

  it("the message says what it is, so nobody has to guess later", async () => {
    await run();
    expect(git("log", "-1", "--format=%s").trim()).toMatch(/^chore\(bootstrap\):/);
  });

  it("a repo that already has commits is left alone: this is the bootstrap phase only", async () => {
    write("README.md", "hi\n");
    git("add", "README.md");
    git("commit", "-qm", "chore: first");
    const result = await run();
    expect(result.steps.find((s) => s.name === "contract").status).toBe("already");
    expect(git("log", "--format=%s").trim().split("\n")).toEqual(["chore: first"]);
  });
});

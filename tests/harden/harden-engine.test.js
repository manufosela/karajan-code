import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installHooks } from "../../src/harden/harden-engine.js";

let repo;

function git(args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-harden-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("installHooks", () => {
  it("installs the standard profile as executable managed hooks and sets hooksPath", async () => {
    const res = await installHooks({ projectDir: repo, profile: "standard" });
    expect(res.hooks.map((h) => h.hook).sort()).toEqual(["commit-msg", "post-merge", "pre-commit", "pre-push", "prepare-commit-msg"]);
    for (const { hook } of res.hooks) {
      const f = join(repo, ".karajan", "hooks", hook);
      expect(existsSync(f)).toBe(true);
      expect(statSync(f).mode & 0o100).not.toBe(0);
      const text = readFileSync(f, "utf8");
      expect(text).toContain("#!/usr/bin/env sh");
      expect(text).toContain(`>>> kj:managed:hook:${hook} v1 >>>`);
    }
    expect(git(["config", "--local", "core.hooksPath"])).toBe(join(".karajan", "hooks"));
  });

  it("minimal profile installs only commit-msg", async () => {
    const res = await installHooks({ projectDir: repo, profile: "minimal" });
    expect(res.hooks.map((h) => h.hook)).toEqual(["commit-msg"]);
    expect(existsSync(join(repo, ".karajan", "hooks", "pre-push"))).toBe(false);
  });

  it("is idempotent: second run reports every hook unchanged with identical bytes", async () => {
    await installHooks({ projectDir: repo, profile: "standard" });
    const before = readFileSync(join(repo, ".karajan", "hooks", "commit-msg"), "utf8");
    const res = await installHooks({ projectDir: repo, profile: "standard" });
    expect(res.hooks.every((h) => h.action === "unchanged")).toBe(true);
    expect(readFileSync(join(repo, ".karajan", "hooks", "commit-msg"), "utf8")).toBe(before);
  });

  it("preserves user content outside the managed block", async () => {
    const dir = join(repo, ".karajan", "hooks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pre-push"), "#!/usr/bin/env sh\necho MY_CUSTOM_GUARD\n");
    await installHooks({ projectDir: repo, profile: "standard" });
    const text = readFileSync(join(dir, "pre-push"), "utf8");
    expect(text).toContain("echo MY_CUSTOM_GUARD");
    expect(text).toContain(">>> kj:managed:hook:pre-push v1 >>>");
  });

  it("dry-run touches neither disk nor git config", async () => {
    const res = await installHooks({ projectDir: repo, profile: "standard", dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.hooks.every((h) => h.action === "inserted")).toBe(true);
    expect(existsSync(join(repo, ".karajan", "hooks", "commit-msg"))).toBe(false);
    expect(() => git(["config", "--local", "core.hooksPath"])).toThrow();
  });

  it("rejects an unknown profile and a non-repo dir", async () => {
    await expect(installHooks({ projectDir: repo, profile: "nope" })).rejects.toThrow(/profile/);
    const plain = mkdtempSync(join(tmpdir(), "kj-plain-"));
    await expect(installHooks({ projectDir: plain })).rejects.toThrow(/Not a git repository/);
    rmSync(plain, { recursive: true, force: true });
  });
});

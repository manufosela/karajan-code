// KJC-TSK-0679 — `kj worktree start|list|done`: the host agent's isolated
// lanes. Born from a field case: an agent NARRATED worktree isolation while
// editing the project root. The compliant path must be the easy one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { worktreeCommand } from "../../src/commands/worktree.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-wt-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  git("add", "a.js"); git("commit", "-qm", "base");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const cfg = () => ({ projectDir: dir });

describe("kj worktree", () => {
  it("start creates the worktree with its feat/ branch and prints the cd", async () => {
    const r = await worktreeCommand({ config: cfg(), action: "start", args: ["mi-tarea"], flags: {} });
    expect(fs.existsSync(r.path)).toBe(true);
    expect(r.branch).toBe("feat/mi-tarea");
    const branches = execFileSync("git", ["-C", r.path, "rev-parse", "--abbrev-ref", "HEAD"]).toString().trim();
    expect(branches).toBe("feat/mi-tarea");
    // the proof the playbook demands: git-dir differs from common-dir in a worktree
    const gitDir = execFileSync("git", ["-C", r.path, "rev-parse", "--git-dir"]).toString().trim();
    const commonDir = execFileSync("git", ["-C", r.path, "rev-parse", "--git-common-dir"]).toString().trim();
    expect(gitDir).not.toBe(commonDir);
  });

  it("start refuses a duplicate slug and path-escaping slugs", async () => {
    await worktreeCommand({ config: cfg(), action: "start", args: ["dup"], flags: {} });
    await expect(worktreeCommand({ config: cfg(), action: "start", args: ["dup"], flags: {} }))
      .rejects.toThrow(/already exists/);
    for (const bad of ["../evil", "a/b", "", "  "]) {
      await expect(worktreeCommand({ config: cfg(), action: "start", args: [bad], flags: {} }))
        .rejects.toThrow(/slug/i);
    }
  });

  it("list shows the lanes", async () => {
    await worktreeCommand({ config: cfg(), action: "start", args: ["uno"], flags: {} });
    await worktreeCommand({ config: cfg(), action: "start", args: ["dos"], flags: {} });
    const rows = await worktreeCommand({ config: cfg(), action: "list", flags: {} });
    expect(rows.map((r) => r.slug).sort()).toEqual(["dos", "uno"]);
  });

  it("done refuses a dirty lane without --force and removes a clean one", async () => {
    const { path: wt } = await worktreeCommand({ config: cfg(), action: "start", args: ["sucia"], flags: {} });
    fs.writeFileSync(path.join(wt, "a.js"), "changed\n");
    await expect(worktreeCommand({ config: cfg(), action: "done", args: ["sucia"], flags: {} }))
      .rejects.toThrow(/uncommitted/);
    const r = await worktreeCommand({ config: cfg(), action: "done", args: ["sucia"], flags: { force: true } });
    expect(r.removed).toBe(true);
    expect(fs.existsSync(wt)).toBe(false);
  });
});

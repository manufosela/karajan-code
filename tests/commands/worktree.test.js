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

  // KJC-TSK-1093: inside the host sandbox .git/config is read-only, so a lane never
  // records an upstream, even where git would by default.
  it("start records no upstream for the lane, whatever branch.autoSetupMerge says", async () => {
    execFileSync("git", ["-C", dir, "config", "branch.autoSetupMerge", "always"]);
    const r = await worktreeCommand({ config: cfg(), action: "start", args: ["sin-upstream"], flags: {} });
    const merge = () => execFileSync("git", ["-C", dir, "config", "--get", `branch.${r.branch}.merge`]);
    expect(merge).toThrow();
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

  // Issue #2566: lanes hang from the main checkout wherever the command runs.
  it("start run inside a lane creates the new lane at the main checkout, not nested", async () => {
    const outer = await worktreeCommand({ config: cfg(), action: "start", args: ["fuera"], flags: {} });
    const inner = await worktreeCommand({ config: { projectDir: outer.path }, action: "start", args: ["dentro"], flags: {} });
    expect(inner.path).toBe(path.join(fs.realpathSync(dir), ".kj/worktrees", "dentro"));
    expect(fs.existsSync(path.join(outer.path, ".kj"))).toBe(false);
  });

  it("list and done from inside a lane see the main checkout's lanes", async () => {
    const a = await worktreeCommand({ config: cfg(), action: "start", args: ["a"], flags: {} });
    await worktreeCommand({ config: cfg(), action: "start", args: ["b"], flags: {} });
    const rows = await worktreeCommand({ config: { projectDir: a.path }, action: "list", flags: {} });
    expect(rows.map((r) => r.slug).sort()).toEqual(["a", "b"]);
    await worktreeCommand({ config: { projectDir: a.path }, action: "done", args: ["b"], flags: {} });
    expect(fs.existsSync(path.join(dir, ".kj/worktrees", "b"))).toBe(false);
  });
});

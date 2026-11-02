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

  // KJC-TSK-1371 (#2852): the lane is ready on creation, with the clone identity and the Sentinel.
  it("start copies the clone identity and wires the Sentinel in the lane, leaving tracked files untouched", async () => {
    fs.mkdirSync(path.join(dir, ".karajan"));
    fs.writeFileSync(path.join(dir, ".karajan", "identity.local.yml"), "github: someone\n");
    const r = await worktreeCommand({ config: cfg(), action: "start", args: ["lista"], flags: {} });
    expect(fs.readFileSync(path.join(r.path, ".karajan", "identity.local.yml"), "utf8")).toBe("github: someone\n");
    expect(JSON.parse(fs.readFileSync(path.join(r.path, ".claude", "settings.json"), "utf8")).hooks).toBeTruthy();
    expect(r.setup).toEqual({ identity: true, wired: true });
    expect(execFileSync("git", ["-C", r.path, "status", "--porcelain", "--untracked-files=no"]).toString()).toBe("");
  });

  it("a failing setup step stops start, naming it and the way to retire the lane", async () => {
    const deps = { setupLane: async () => { throw new Error("lane setup failed at the Sentinel wiring: EACCES"); } };
    await expect(worktreeCommand({ config: cfg(), action: "start", args: ["rota"], flags: {}, deps }))
      .rejects.toThrow(/Sentinel wiring: EACCES.*kj worktree done rota --force/);
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

  // HU-3114 (#2758 3/3): done stops the lane's background indexer while the lane still exists.
  it("done stops the lane's indexer before removing it; a failure only warns", async () => {
    const { path: wt } = await worktreeCommand({ config: cfg(), action: "start", args: ["idx"], flags: {} });
    const calls = [];
    const stopBootstrap = async (p, o) => { calls.push({ p, o, existed: fs.existsSync(p) }); return { stopped: true }; };
    const r = await worktreeCommand({ config: cfg(), action: "done", args: ["idx"], flags: {}, deps: { stopBootstrap } });
    expect(calls).toEqual([{ p: wt, o: { force: true }, existed: true }]);
    expect(r.indexerStopped).toEqual({ stopped: true });

    const { path: wt2 } = await worktreeCommand({ config: cfg(), action: "start", args: ["boom"], flags: {} });
    const boom = async () => { throw new Error("ps unavailable"); };
    const r2 = await worktreeCommand({ config: cfg(), action: "done", args: ["boom"], flags: {}, deps: { stopBootstrap: boom } });
    expect(r2.removed).toBe(true);
    expect(r2.indexerStopped).toBeNull();
    expect(fs.existsSync(wt2)).toBe(false);
  });

  it("a dirty lane refused by done does not touch its indexer", async () => {
    const { path: wt } = await worktreeCommand({ config: cfg(), action: "start", args: ["dirty"], flags: {} });
    fs.writeFileSync(path.join(wt, "a.js"), "changed\n");
    let called = false;
    const stopBootstrap = async () => { called = true; };
    await expect(worktreeCommand({ config: cfg(), action: "done", args: ["dirty"], flags: {}, deps: { stopBootstrap } }))
      .rejects.toThrow(/uncommitted/);
    expect(called).toBe(false);
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

// HU-2761 (#2566 plan PR 5): lanes branch from origin/<base>; done deletes the merged branch.
describe("kj worktree lifecycle", () => {
  const g = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args]).toString().trim();
  const commit = (cwd, file) => { fs.writeFileSync(path.join(cwd, file), `${file}\n`); g(cwd, "add", file); g(cwd, "commit", "-qm", file); };
  const run = (action, slug, flags = {}, projectDir = dir) => worktreeCommand({ config: { projectDir }, action, args: [slug], flags });
  const branches = (name) => g(dir, "branch", "--list", name);

  it("start branches from origin/main, not the current HEAD, and still records no upstream", async () => {
    g(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    const origin = g(dir, "rev-parse", "HEAD");
    commit(dir, "x.js");
    g(dir, "checkout", "-q", "-b", "side");
    commit(dir, "y.js");
    const r = await run("start", "from-origin");
    expect(g(r.path, "rev-parse", "HEAD")).toBe(origin);
    expect(() => g(dir, "config", "--get", "branch.feat/from-origin.merge")).toThrow();
  });

  it("start without origin falls back to local main and warns", async () => {
    const mainSha = g(dir, "rev-parse", "main");
    g(dir, "checkout", "-q", "-b", "side");
    commit(dir, "y.js");
    const warns = [];
    const orig = console.warn;
    console.warn = (m) => warns.push(m);
    let r;
    try { r = await run("start", "local-base"); } finally { console.warn = orig; }
    expect(g(r.path, "rev-parse", "HEAD")).toBe(mainSha);
    expect(warns.join("\n")).toMatch(/local main/);
  });

  it("start fails loudly when the base does not exist", async () => {
    g(dir, "branch", "-m", "main", "trunk");
    await expect(run("start", "nobase")).rejects.toThrow(/base "main" not found/);
  });

  it("start from inside a lane does not inherit that lane's commits", async () => {
    const outer = await run("start", "outer");
    commit(outer.path, "outer.js");
    const inner = await run("start", "inner", {}, outer.path);
    expect(fs.existsSync(path.join(inner.path, "outer.js"))).toBe(false);
  });

  it("done deletes a merged branch and the slug can be reused", async () => {
    const lane = await run("start", "x");
    commit(lane.path, "x.js");
    g(dir, "merge", "-q", "--no-ff", "-m", "merge x", "feat/x");
    const r = await run("done", "x");
    expect(r).toMatchObject({ branchDeleted: true, merged: true, branch: "feat/x" });
    expect(branches("feat/x")).toBe("");
    await expect(run("start", "x")).resolves.toBeDefined();
  });

  it("done keeps an unmerged branch; --force deletes it", async () => {
    const lane = await run("start", "keep");
    commit(lane.path, "k.js");
    const kept = await run("done", "keep");
    expect(kept).toMatchObject({ branchDeleted: false, merged: false });
    expect(branches("feat/keep")).toContain("feat/keep");
    const lane2 = await run("start", "force");
    commit(lane2.path, "f.js");
    const forced = await run("done", "force", { force: true });
    expect(forced.branchDeleted).toBe(true);
    expect(branches("feat/force")).toBe("");
  });

  it("done does not call a squash merge merged", async () => {
    const lane = await run("start", "sq");
    commit(lane.path, "s.js");
    g(dir, "merge", "-q", "--squash", "feat/sq");
    g(dir, "commit", "-qm", "squash sq");
    const r = await run("done", "sq");
    expect(r).toMatchObject({ branchDeleted: false, merged: false });
    expect(branches("feat/sq")).toContain("feat/sq");
  });

  it("done judges against origin/main: merged into local main only is not merged", async () => {
    g(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    const lane = await run("start", "lag");
    commit(lane.path, "l.js");
    g(dir, "merge", "-q", "--no-ff", "-m", "merge lag", "feat/lag");
    const r = await run("done", "lag");
    expect(r).toMatchObject({ branchDeleted: false, merged: false });
  });

  it("done still removes a clean lane when the base no longer exists, keeping the branch", async () => {
    const lane = await run("start", "nb");
    g(dir, "branch", "-m", "main", "trunk");
    const r = await run("done", "nb");
    expect(r).toMatchObject({ removed: true, branchDeleted: false });
    expect(fs.existsSync(lane.path)).toBe(false);
    expect(branches("feat/nb")).toContain("feat/nb");
  });

  it("start refuses a leftover branch with the exact remedy", async () => {
    g(dir, "branch", "feat/left");
    await expect(run("start", "left")).rejects.toThrow(/already exists.*branch -D/);
  });
});

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWorktree, removeWorktree, listWorktrees, cleanupOrphans, worktreesRoot } from "../src/worktree.js";

let repo;
const g = (...args) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-wt-"));
  g("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "base");
  g("add", "a.txt");
  g("commit", "-qm", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("worktree primitive (KJC-TSK-0622)", () => {
  it("creates a worktree with its branch, lists it, and removes it", async () => {
    const { dir, branch } = await createWorktree({ projectDir: repo, id: "HU-001", branch: "feat/HU-001" });
    expect(dir).toBe(join(worktreesRoot(repo), "HU-001"));
    expect(branch).toBe("feat/HU-001");
    expect(existsSync(join(dir, "a.txt"))).toBe(true);

    const listed = await listWorktrees(repo);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: "HU-001", branch: "feat/HU-001" });

    await removeWorktree({ projectDir: repo, id: "HU-001" });
    expect(existsSync(dir)).toBe(false);
    expect(await listWorktrees(repo)).toHaveLength(0);
  });

  it("only lists kj-managed worktrees, not the main tree or foreign ones", async () => {
    g("worktree", "add", "-b", "foreign", join(repo, "..", `foreign-${Date.now()}`));
    await createWorktree({ projectDir: repo, id: "HU-002", branch: "feat/HU-002" });
    const listed = await listWorktrees(repo);
    expect(listed.map((w) => w.id)).toEqual(["HU-002"]);
  });

  it("refuses to create over an existing worktree (the caller decides)", async () => {
    await createWorktree({ projectDir: repo, id: "HU-003", branch: "feat/HU-003" });
    await expect(createWorktree({ projectDir: repo, id: "HU-003", branch: "feat/other" })).rejects.toThrow(
      /already exists/,
    );
  });

  it("fails loudly with git's stderr on a bad baseRef", async () => {
    await expect(
      createWorktree({ projectDir: repo, id: "HU-004", branch: "feat/HU-004", baseRef: "no-such-ref" }),
    ).rejects.toThrow(/no-such-ref|invalid reference/);
  });

  it("cleanupOrphans removes everything not kept, even with dirty files, and survives vanished dirs", async () => {
    const a = await createWorktree({ projectDir: repo, id: "HU-A", branch: "feat/HU-A" });
    await createWorktree({ projectDir: repo, id: "HU-B", branch: "feat/HU-B" });
    const c = await createWorktree({ projectDir: repo, id: "HU-C", branch: "feat/HU-C" });
    writeFileSync(join(a.dir, "dirty.txt"), "uncommitted"); // dirty ⇒ needs force
    rmSync(c.dir, { recursive: true, force: true }); // vanished dir (crash simulation)

    const removed = await cleanupOrphans(repo, { keep: ["HU-B"] });
    expect(removed.sort()).toEqual(["HU-A", "HU-C"].filter((id) => removed.includes(id)).sort());
    const left = await listWorktrees(repo);
    expect(left.map((w) => w.id)).toEqual(["HU-B"]);
  });
});

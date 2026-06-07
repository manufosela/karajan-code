// snapshotGitBundle tests (KJC-TSK-0389 commit 1). Uses a real git repo
// in a tmpdir to exercise `git bundle create --all` end-to-end.
import { mkdtemp, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";

import { snapshotGitBundle } from "../src/git-snapshot.js";
import { readLog } from "../src/logger.js";
import { FILE_MODE } from "../src/permissions.js";

function git(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

async function tmpRoot() {
  return mkdtemp(join(tmpdir(), "ai-trash-gitsnap-"));
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), "ai-trash-repo-"));
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.invalid"], dir);
  git(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "README"), "v1");
  git(["add", "README"], dir);
  git(["commit", "-q", "-m", "initial"], dir);
  return dir;
}

describe("snapshotGitBundle", () => {
  it("creates a bundle that re-fetches the original HEAD after a hard reset", async () => {
    const root = await tmpRoot();
    const repo = await makeRepo();
    const headBefore = git(["rev-parse", "HEAD"], repo);

    const entry = await snapshotGitBundle(root, repo, {
      command: "git reset --hard HEAD~1",
      origin: "claude",
    });
    expect(entry.type).toBe("git-bundle");
    expect(entry.snapshotPath).toBe(join(root, "store", entry.id, "repo.bundle"));
    expect(entry.refs.some((r) => r.sha === headBefore)).toBe(true);
    expect(entry.command).toBe("git reset --hard HEAD~1");

    const info = await stat(entry.snapshotPath);
    expect(info.mode & 0o777).toBe(FILE_MODE);
    expect(info.size).toBeGreaterThan(0);

    await writeFile(join(repo, "README"), "v2");
    git(["add", "README"], repo);
    git(["commit", "-q", "-m", "second"], repo);
    git(["reset", "--hard", "HEAD~1"], repo);
    expect(git(["rev-parse", "HEAD"], repo)).toBe(headBefore);

    const fetched = spawnSync(
      "git",
      ["fetch", entry.snapshotPath, "+refs/heads/*:refs/remotes/restore/*"],
      { cwd: repo, encoding: "utf8" }
    );
    expect(fetched.status).toBe(0);
    const restored = git(["rev-parse", "refs/remotes/restore/main"], repo);
    expect(restored).toBe(headBefore);

    const log = await readLog(root);
    expect(log).toHaveLength(1);
    expect(log[0].event).toBe("snapshot.git-bundle");
    expect(log[0].id).toBe(entry.id);
    expect(log[0].refCount).toBe(entry.refs.length);
  });

  it("rejects when the directory is not a git repo", async () => {
    const root = await tmpRoot();
    const notRepo = await mkdtemp(join(tmpdir(), "ai-trash-notrepo-"));
    await expect(snapshotGitBundle(root, notRepo)).rejects.toThrow(/not a git repo/);
  });
});

// KJC-BUG-0441 (#2815): a kj worktree lane shares the HU store of its repo; the project is the
// main checkout, never the lane folder's name.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createManualHu, listHus } from "../../src/hu/store.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "ignore" });

describe("HU store inside a lane", () => {
  let tmp, repo, lane;
  const origHome = process.env.KJ_HOME;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu-lane-")));
    process.env.KJ_HOME = path.join(tmp, "home");
    repo = path.join(tmp, "repo");
    lane = path.join(tmp, "repo-lane-x");
    fs.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    git(repo, "worktree", "add", "-q", "-b", "lane-x", lane);
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.KJ_HOME; else process.env.KJ_HOME = origHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a card added from a lane is listed from the main checkout, and the other way round", async () => {
    await createManualHu(lane, { title: "from the lane" });
    await createManualHu(repo, { title: "from main" });
    const titles = (hus) => hus.map((h) => h.title).toSorted();
    expect(titles(await listHus(repo))).toEqual(["from main", "from the lane"]);
    expect(titles(await listHus(lane))).toEqual(["from main", "from the lane"]);
  });
});

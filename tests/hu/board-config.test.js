// KJC-TSK-1163 (TEAM-GH-B, ADR 0025): a repo turns the shared board on once, in a versioned
// file the whole team inherits; kj never turns it on just because the remote is GitHub.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { readBoardConfig, setBoardBackend, repoFromRemote } from "../../src/hu/board-config.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-board-")); fs.mkdirSync(path.join(dir, ".karajan")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const gitWith = ({ remote = "git@github.com:acme/app.git", ignored = false } = {}) => async (cmd, args) => {
  if (args.includes("get-url")) return { exitCode: 0, stdout: `${remote}\n` };
  if (args.includes("check-ignore")) return { exitCode: ignored ? 0 : 1, stdout: "" };
  throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
};

describe("repoFromRemote", () => {
  it("reads owner/repo from https, ssh and ssh host aliases", () => {
    expect(repoFromRemote("https://github.com/acme/app.git")).toBe("acme/app");
    expect(repoFromRemote("git@github.com:acme/app.git")).toBe("acme/app");
    expect(repoFromRemote("github.com-work:acme/app.git")).toBe("acme/app");
    expect(repoFromRemote("ssh://git@github.com/acme/app.git")).toBe("acme/app");
    expect(repoFromRemote("https://gitlab.com/acme/app.git")).toBeNull();
    // Lookalike hosts are not GitHub.
    expect(repoFromRemote("git@github.com.evil:attacker/repo.git")).toBeNull();
    expect(repoFromRemote("https://evilgithub.com/attacker/repo.git")).toBeNull();
    expect(repoFromRemote("https://github.com.evil/attacker/repo.git")).toBeNull();
  });
});

describe("board config", () => {
  it("is the local board until the repo turns the shared one on", async () => {
    expect(await readBoardConfig(dir)).toEqual({ backend: "local" });
  });

  it("kj hu backend github writes the versioned file with the repo from origin", async () => {
    fs.rmSync(path.join(dir, ".karajan"), { recursive: true }); // a repo with no .karajan yet
    const r = await setBoardBackend({ projectDir: dir, backend: "github", run: gitWith() });
    expect(r).toMatchObject({ backend: "github", repo: "acme/app", gitignoreChanged: false });
    expect(await readBoardConfig(dir)).toEqual({ backend: "github", repo: "acme/app" });
  });

  // Real git from here: what counts is whether git itself still ignores the file.
  const realRepo = (gitignore, exclude = null) => {
    const git = (...a) => execFileSync("git", ["-C", dir, ...a]);
    git("init", "-q");
    git("remote", "add", "origin", "git@github.com:acme/app.git");
    if (gitignore !== null) fs.writeFileSync(path.join(dir, ".gitignore"), gitignore);
    if (exclude) fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), exclude);
    return () => execFileSync("git", ["-C", dir, "check-ignore", "-q", ".karajan/board.yml"], { stdio: "ignore" });
  };

  it.each([
    [".karajan/* (star exclude)", ".karajan/*\n", null],
    [".karajan/ (directory exclude, which git cannot re-include into)", ".karajan/\n", null],
    ["no .gitignore and a local star exclude", null, ".karajan/*\n"],
  ])("leaves git tracking the file with %s", async (_, gitignore, exclude) => {
    const checkIgnore = realRepo(gitignore, exclude);
    const r = await setBoardBackend({ projectDir: dir, backend: "github" });
    expect(r.gitignoreChanged).toBe(true);
    expect(checkIgnore).toThrow(); // exit 1: not ignored any more
  });

  it("says so when nothing in .gitignore can re-include it (a local directory exclude)", async () => {
    realRepo(null, ".karajan/\n");
    await expect(setBoardBackend({ projectDir: dir, backend: "github" })).rejects.toThrow(/git still ignores \.karajan\/board\.yml/);
    expect(fs.existsSync(path.join(dir, ".karajan", "board.yml"))).toBe(false); // nothing left behind
    expect(await readBoardConfig(dir)).toEqual({ backend: "local" });
  });

  it("refuses a remote that is not GitHub and a file it cannot trust", async () => {
    await expect(setBoardBackend({ projectDir: dir, backend: "github", run: gitWith({ remote: "https://gitlab.com/a/b.git" }) })).rejects.toThrow(/not a GitHub remote/);
    await expect(setBoardBackend({ projectDir: dir, backend: "jira", run: gitWith() })).rejects.toThrow(/github, local/);
    fs.writeFileSync(path.join(dir, ".karajan", "board.yml"), "backend: github\nrepo: not a repo\n");
    await expect(readBoardConfig(dir)).rejects.toThrow(/owner\/repo/);
  });
});

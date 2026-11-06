// KJC-BUG-0233: el guard de rama base (KJC-TSK-0648) protegia siempre "main",
// porque harden leia base_branch del RESULTADO de loadConfig y no de su config.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveBaseBranch } from "../../src/commands/harden.js";

let home, proj, prev;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-bb-home-"));
  proj = mkdtempSync(join(tmpdir(), "kj-bb-proj-"));
  prev = process.env.KJ_HOME;
  process.env.KJ_HOME = home;
  writeFileSync(join(home, "kj.config.yml"), "");
});
afterEach(() => {
  if (prev === undefined) delete process.env.KJ_HOME; else process.env.KJ_HOME = prev;
  rmSync(home, { recursive: true, force: true });
  rmSync(proj, { recursive: true, force: true });
});

describe("resolveBaseBranch", () => {
  it("honra el base_branch que declara el proyecto (con el loadConfig real)", async () => {
    mkdirSync(join(proj, ".karajan"));
    writeFileSync(join(proj, ".karajan", "kj.config.yml"), "base_branch: develop\n");
    expect(await resolveBaseBranch(proj)).toBe("develop");
  });

  it("sin declararlo, o sin config legible, y sin remoto, main", async () => {
    expect(await resolveBaseBranch(proj)).toBe("main");
    expect(await resolveBaseBranch(proj, async () => { throw new Error("no config"); })).toBe("main");
  });
});

// HU-3522 (#3519, punto 3): the base branch is read from the repository, not assumed.
describe("resolveBaseBranch: remote HEAD", () => {
  const git = (...args) => execFileSync("git", ["-C", proj, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
  const withRemoteHead = (branch) => {
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("remote", "add", "origin", "https://example.invalid/r.git");
    git("update-ref", `refs/remotes/origin/${branch}`, "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branch}`);
  };

  it("uses the remote HEAD branch, without the origin/ prefix", async () => {
    withRemoteHead("develop");
    expect(await resolveBaseBranch(proj)).toBe("develop");
  });

  it("never overwrites a base_branch the person set, even if it is main", async () => {
    withRemoteHead("develop");
    mkdirSync(join(proj, ".karajan"));
    writeFileSync(join(proj, ".karajan", "kj.config.yml"), "base_branch: main\n");
    expect(await resolveBaseBranch(proj)).toBe("main");
    writeFileSync(join(proj, ".karajan", "kj.config.yml"), "base_branch: release\n");
    expect(await resolveBaseBranch(proj)).toBe("release");
  });

  it("keeps an explicit main from the global config over the remote HEAD", async () => {
    withRemoteHead("develop");
    writeFileSync(join(home, "kj.config.yml"), "base_branch: main\n");
    expect(await resolveBaseBranch(proj)).toBe("main");
  });

  it("keeps an explicit main from the local override over the remote HEAD", async () => {
    withRemoteHead("develop");
    mkdirSync(join(proj, ".karajan"));
    writeFileSync(join(proj, ".karajan", "kj.config.local.yml"), "base_branch: main\n");
    expect(await resolveBaseBranch(proj)).toBe("main");
  });

  it("falls back to main and says it could not read the default branch", async () => {
    git("init", "-q");
    const info = [];
    expect(await resolveBaseBranch(proj, undefined, { info: (m) => info.push(m) })).toBe("main");
    expect(info.join("\n")).toMatch(/could not read the default branch/);
  });

  it("says nothing when the remote HEAD is read", async () => {
    withRemoteHead("develop");
    const info = [];
    await resolveBaseBranch(proj, undefined, { info: (m) => info.push(m) });
    expect(info).toEqual([]);
  });
});

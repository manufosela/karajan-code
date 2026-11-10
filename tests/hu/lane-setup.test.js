// KJC-TSK-1371 (#2852, #2566 PR 6): a new lane gets the clone identity and the Sentinel
// wiring on creation, so the first write there is governed and the identity lock knows who pushes.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { laneWork, setupLane } from "../../src/hu/lane-setup.js";

let main;
let lane;
const IDENTITY = "github: manufosela\nemail: someone@users.noreply.github.com\n";
const quiet = { info: () => {}, warn: () => {} };
const wired = { sentinel: () => ({ wired: true }), harness: () => ({ wired: true }) };

beforeEach(() => {
  main = fs.mkdtempSync(path.join(os.tmpdir(), "kj-main-"));
  lane = fs.mkdtempSync(path.join(os.tmpdir(), "kj-lane-"));
});
afterEach(() => {
  fs.rmSync(main, { recursive: true, force: true });
  fs.rmSync(lane, { recursive: true, force: true });
});

describe("hu/lane-setup — KJC-TSK-1371", () => {
  it("copies the main checkout's identity into the lane and installs the Sentinel there", async () => {
    fs.mkdirSync(path.join(main, ".karajan"));
    fs.writeFileSync(path.join(main, ".karajan", "identity.local.yml"), IDENTITY);
    const calls = [];
    const install = { sentinel: (o) => { calls.push(["sentinel", o.projectDir, o.moveShared]); return { wired: true }; }, harness: (o) => { calls.push(["harness", o.projectDir, o.moveShared]); return { wired: true }; } };
    const r = await setupLane({ mainDir: main, lanePath: lane, logger: quiet, install });
    expect(fs.readFileSync(path.join(lane, ".karajan", "identity.local.yml"), "utf8")).toBe(IDENTITY);
    // KJC-BUG-0537 (#3739): the lane never edits the branch's versioned settings.json.
    expect(calls).toEqual([["sentinel", lane, false], ["harness", lane, false]]);
    expect(r).toEqual({ identity: true, config: false, wired: true });
  });

  // HU-3574 (#3554): only a config git ignores travels, and only that copy is setup.
  describe("the operator's local kj config — #3554", () => {
    const CONFIG = ".karajan/kj.config.yml";
    const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
    const put = (dir, text) => {
      fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
      fs.writeFileSync(path.join(dir, CONFIG), text);
    };
    // A main checkout with `ignore` as its .gitignore and a lane cut from it, as kj worktree start does.
    const cut = (ignore) => {
      git(main, "init", "-q", "-b", "main");
      fs.writeFileSync(path.join(main, ".gitignore"), ignore);
      git(main, "add", ".gitignore");
      git(main, "commit", "-qm", "base");
      git(main, "worktree", "add", "-q", "--no-track", "-b", "feat/lane", lane);
    };
    const start = (logger = quiet) => setupLane({ mainDir: main, lanePath: lane, logger, install: wired });

    it("copies a config git ignores, byte for byte, and the lane does not count it as its work", async () => {
      cut("kj.config.yml\n");
      put(main, "development:\n  source_file_extensions: [.js]\n");
      const infos = [];
      const r = await start({ info: (m) => infos.push(m), warn: () => {} });
      expect(fs.readFileSync(path.join(lane, CONFIG), "utf8")).toBe("development:\n  source_file_extensions: [.js]\n");
      expect(r.config).toBe(true);
      expect(infos).toContain(`  config: ${CONFIG} copied from the main checkout (git ignores it)`);
      expect(laneWork(git(lane, "status", "--porcelain", "--ignored=matching", "--untracked-files=all"), lane)).toEqual([]);
    });

    it.each([
      ["tracked by the main checkout (forced past the pattern) and absent on the lane branch", "kj.config.yml\n", () => { git(main, "add", "-f", CONFIG); git(main, "commit", "-qm", "config"); }],
      ["untracked but not ignored", "", () => {}],
      ["ignored by the main checkout but not by the lane", "", () => fs.writeFileSync(path.join(main, ".gitignore"), "kj.config.yml\n")],
    ])("never injects a config %s", async (_case, ignore, arrange) => {
      cut(ignore);
      put(main, "x: 1\n");
      arrange();
      expect((await start()).config).toBe(false);
      expect(fs.existsSync(path.join(lane, CONFIG))).toBe(false);
    });

    it("never overwrites the lane's own config and says nothing", async () => {
      put(main, "from: main\n");
      put(lane, "from: lane\n");
      const infos = [];
      const r = await start({ info: (m) => infos.push(m), warn: () => {} });
      expect(fs.readFileSync(path.join(lane, CONFIG), "utf8")).toBe("from: lane\n");
      expect(r.config).toBe(false);
      expect(infos.join("\n")).not.toMatch(/config:/);
    });

    it("without one in the main checkout it does nothing and does not warn", async () => {
      const warnings = [];
      const r = await start({ info: () => {}, warn: (m) => warnings.push(m) });
      expect(r.config).toBe(false);
      expect(warnings.join("\n")).not.toMatch(/kj\.config/);
      expect(fs.existsSync(path.join(lane, CONFIG))).toBe(false);
    });

    it("a git that cannot answer stops the start, naming the step", async () => {
      put(main, "x: 1\n"); // the main checkout here is no git repository
      await expect(start()).rejects.toThrow(/lane setup failed at the local kj config: git check-ignore failed/);
    });

    it("laneWork drops it only as the inherited copy: ignored and still the main checkout's bytes", async () => {
      cut("kj.config.yml\n");
      put(main, "x: 1\n");
      await start();
      expect(laneWork(`!! ${CONFIG}\n!! .karajan/`, lane)).toEqual([]);
      expect(laneWork(`?? ${CONFIG}\n M ${CONFIG}`, lane)).toEqual([`?? ${CONFIG}`, ` M ${CONFIG}`]);
      expect(laneWork(`!! ${CONFIG}`)).toEqual([`!! ${CONFIG}`]); // no lane to compare: not provably inherited
      put(lane, "x: 2\n");
      expect(laneWork(`!! ${CONFIG}\n!! .karajan/`, lane)).toEqual([`!! ${CONFIG}`, "!! .karajan/"]);
      put(lane, "x: 1\n");
      fs.rmSync(path.join(main, CONFIG)); // gone from the main checkout: nothing proves the lane's is a copy
      expect(laneWork(`!! ${CONFIG}`, lane)).toEqual([`!! ${CONFIG}`]);
    });
  });

  it("without an identity in the main checkout it warns and goes on", async () => {
    const warnings = [];
    const r = await setupLane({ mainDir: main, lanePath: lane, logger: { info: () => {}, warn: (m) => warnings.push(m) }, install: wired });
    expect(r.identity).toBe(false);
    expect(warnings.join("\n")).toMatch(/kj identity set/);
    expect(fs.existsSync(path.join(lane, ".karajan", "identity.local.yml"))).toBe(false);
  });

  it("setup files are not the lane's work, file by file or as a folder git lists whole", () => {
    fs.mkdirSync(path.join(lane, ".claude"));
    fs.writeFileSync(path.join(lane, ".claude", "settings.json"), "{}");
    const status = "?? .karajan/identity.local.yml\n?? .karajan/harness/sentinel-state.json\n!! .claude/\n?? src/real.js\n";
    expect(laneWork(status, lane)).toEqual(["?? src/real.js"]);
    fs.writeFileSync(path.join(lane, ".claude", "notes.md"), "mine");
    expect(laneWork(status, lane)).toEqual(["!! .claude/", "?? src/real.js"]);
  });

  it("a step that fails names the step; unwired settings count as a failure", async () => {
    const broken = { sentinel: () => { throw new Error("EACCES"); }, harness: wired.harness };
    await expect(setupLane({ mainDir: main, lanePath: lane, logger: quiet, install: broken })).rejects.toThrow(/Sentinel wiring.*EACCES/);
    const unwired = { sentinel: () => ({ wired: false }), harness: wired.harness };
    await expect(setupLane({ mainDir: main, lanePath: lane, logger: quiet, install: unwired })).rejects.toThrow(/Sentinel wiring.*not wired/);
  });
});

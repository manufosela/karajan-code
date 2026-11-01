// KJC-TSK-1371 (#2852, #2566 PR 6): a new lane gets the clone identity and the Sentinel
// wiring on creation, so the first write there is governed and the identity lock knows who pushes.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    const install = { sentinel: (o) => { calls.push(["sentinel", o.projectDir]); return { wired: true }; }, harness: (o) => { calls.push(["harness", o.projectDir]); return { wired: true }; } };
    const r = await setupLane({ mainDir: main, lanePath: lane, logger: quiet, install });
    expect(fs.readFileSync(path.join(lane, ".karajan", "identity.local.yml"), "utf8")).toBe(IDENTITY);
    expect(calls).toEqual([["sentinel", lane], ["harness", lane]]);
    expect(r).toEqual({ identity: true, wired: true });
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

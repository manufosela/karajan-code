// KJC-TSK-1444 (ADR, 6-nov): the Sentinel's wiring lives in .claude/settings.local.json, ignored by
// git and personal, so a teammate who uses Claude Code without kj is not blocked by a versioned
// settings.json. A repo that already versions the kj hooks there has them moved out, the rest kept.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HARNESS_WIRING, guardCommand, mergeClaudeHooks, wiringState } from "../../src/harden/harness-hooks.js";

let dir, prevGlobal;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-local-settings-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  // The machine's global gitignore may already ignore the file: judge this clone alone.
  prevGlobal = [process.env.GIT_CONFIG_GLOBAL, process.env.XDG_CONFIG_HOME];
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, "no-global-config");
  process.env.XDG_CONFIG_HOME = path.join(dir, "no-xdg");
});
const ignored = () => spawnSync("git", ["check-ignore", "-q", ".claude/settings.local.json"], { cwd: dir }).status === 0;
afterEach(() => {
  for (const [key, value] of [["GIT_CONFIG_GLOBAL", prevGlobal[0]], ["XDG_CONFIG_HOME", prevGlobal[1]]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, ".claude", name), "utf8"));
const kjCommand = guardCommand("pretooluse", { blocking: true, viaKj: false });
const commandsIn = (name) => read(name).hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command));

describe("the Sentinel's wiring is personal", () => {
  it("is written to settings.local.json, which git ignores through the clone's exclude, never .gitignore", () => {
    expect(mergeClaudeHooks({ projectDir: dir, entries: HARNESS_WIRING, viaKj: false }).wired).toBe(true);
    expect(commandsIn("settings.local.json")).toContain(kjCommand);
    expect(fs.existsSync(path.join(dir, ".claude", "settings.json"))).toBe(false);
    expect(ignored()).toBe(true);
    expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
    mergeClaudeHooks({ projectDir: dir, entries: HARNESS_WIRING, viaKj: false });
    expect(fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8").match(/settings\.local\.json/g)).toHaveLength(1);
  });

  it("moves kj's hooks out of a versioned settings.json and keeps everything else there", () => {
    fs.mkdirSync(path.join(dir, ".claude"));
    const theirs = { type: "command", command: "echo team hook" };
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [theirs, { type: "command", command: kjCommand }] }] },
    }));
    mergeClaudeHooks({ projectDir: dir, entries: HARNESS_WIRING, viaKj: false });
    const shared = read("settings.json");
    expect(shared.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(shared.hooks.PreToolUse).toEqual([{ matcher: "Bash", hooks: [theirs] }]);
    expect(commandsIn("settings.local.json")).toContain(kjCommand);
  });

  it("finds the wiring in either file, so a repo not yet migrated is not reported broken", () => {
    fs.mkdirSync(path.join(dir, ".claude"));
    const wired = { hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: kjCommand }] }, { matcher: "Bash", hooks: [{ type: "command", command: kjCommand }] }] } };
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify(wired));
    expect(wiringState({ projectDir: dir, entries: HARNESS_WIRING }).missing).toEqual([]);
    fs.rmSync(path.join(dir, ".claude", "settings.json"));
    fs.writeFileSync(path.join(dir, ".claude", "settings.local.json"), JSON.stringify(wired));
    expect(wiringState({ projectDir: dir, entries: HARNESS_WIRING }).missing).toEqual([]);
  });
});

// KJC-BUG-0528: a lane created before KJC-TSK-1444 has no settings of its own; the Sentinel hook that
// runs there was loaded from the main checkout's, so that is the wiring to verify. Only then.
describe("a lane with no settings of its own", () => {
  let main;
  beforeEach(() => { main = fs.mkdtempSync(path.join(os.tmpdir(), "kj-main-checkout-")); });
  afterEach(() => fs.rmSync(main, { recursive: true, force: true }));
  const wire = (root, entries = HARNESS_WIRING) => mergeClaudeHooks({ projectDir: root, entries, viaKj: false });
  const stateOf = (projectDir, mainOf = () => main) => wiringState({ projectDir, entries: HARNESS_WIRING, mainOf });

  it("is verified against the main checkout's wiring", () => {
    wire(main);
    expect(stateOf(dir).missing).toEqual([]);
  });

  it("stays missing everything, named with the lane's file, when the main checkout has none either", () => {
    expect(stateOf(dir).missing).toEqual([".claude/settings.local.json (sin hooks legibles)"]);
  });

  it("with its own settings missing a guard keeps that guard missing, whatever the main checkout has", () => {
    wire(main);
    wire(dir, HARNESS_WIRING.slice(1));
    const [first] = HARNESS_WIRING;
    expect(stateOf(dir).missing).toEqual([`${first.event} → ${first.script.replace(/\.mjs$/, "")}`]);
  });

  it("in the main checkout itself, an unwired dir is reported as before", () => {
    expect(stateOf(main, (d) => d).missing).toEqual([".claude/settings.local.json (sin hooks legibles)"]);
  });

  it("finds the main checkout of a real git lane by default", () => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
    const lane = path.join(dir, "lane");
    execFileSync("git", ["worktree", "add", "-q", lane], { cwd: dir });
    wire(dir);
    expect(wiringState({ projectDir: lane, entries: HARNESS_WIRING }).missing).toEqual([]);
  });
});

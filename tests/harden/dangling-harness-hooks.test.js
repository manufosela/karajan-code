// HU-4768: a hook that still runs a retired harness copy crashes node on every tool call.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSentinelHooks, GOVERNING_WIRING } from "../../src/harden/sentinel-hooks.js";
import { wiringState } from "../../src/harden/harness-hooks.js";

const COMMAND = "node .karajan/harness/posttooluse.mjs";
let dir;
const harness = (name) => path.join(dir, ".karajan", "harness", name);
const writeShared = (command) => {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const hooks = { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] };
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ hooks }));
};

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-dangling-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("retiring guard copies", () => {
  it("keeps a copy that settings.json still runs and says which file calls it", () => {
    writeShared(COMMAND);
    fs.mkdirSync(path.dirname(harness("x")), { recursive: true });
    fs.writeFileSync(harness("posttooluse.mjs"), "// copy");
    const info = [];
    const res = installSentinelHooks({ projectDir: dir, moveShared: false, logger: { info: (m) => info.push(m), warn() {} } });
    expect(fs.existsSync(harness("posttooluse.mjs"))).toBe(true);
    expect(res.retired).not.toContain("posttooluse.mjs");
    expect(info.join("\n")).toMatch(/settings\.json.*posttooluse\.mjs|posttooluse\.mjs.*settings\.json/);
  });

  it("still retires a copy nobody calls", () => {
    fs.mkdirSync(path.dirname(harness("x")), { recursive: true });
    fs.writeFileSync(harness("posttooluse.mjs"), "// copy");
    installSentinelHooks({ projectDir: dir, moveShared: false });
    expect(fs.existsSync(harness("posttooluse.mjs"))).toBe(false);
  });
});

describe("wiringState dangling", () => {
  const state = () => wiringState({ projectDir: dir, entries: GOVERNING_WIRING });

  it("lists a hook that runs a harness file that does not exist", () => {
    writeShared(COMMAND);
    expect(state().dangling).toEqual([`.claude/settings.json PostToolUse → ${COMMAND}`]);
  });

  it("lists the $CLAUDE_PROJECT_DIR form too", () => {
    const command = 'node "$CLAUDE_PROJECT_DIR"/.karajan/harness/posttooluse.mjs';
    writeShared(command);
    expect(state().dangling).toEqual([`.claude/settings.json PostToolUse → ${command}`]);
  });

  it("is empty when the file exists", () => {
    writeShared(COMMAND);
    fs.mkdirSync(path.dirname(harness("x")), { recursive: true });
    fs.writeFileSync(harness("posttooluse.mjs"), "// copy");
    expect(state().dangling).toEqual([]);
  });
});

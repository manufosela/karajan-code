// KJC-BUG-0366: kj handoff add only STORES the command it registers for the human
// and its --why; the lane guard read them as quoted paths with spaces and the
// human-act guards as acts, so the agent could not register what the method asks.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { stripTextOnlyCommandValues, stripTextOptionValues } from "../../src/harden/sentinel/sentinel-shell.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

const HC = ["kj", "harden", "--commit"].join(" ");

describe("kj handoff add stores text", () => {
  it("blanks its quoted command and its --why", () => {
    expect(stripTextOptionValues(`kj handoff add 'bash /tmp/a b/p.sh' --why 'publish it'`)).toBe(`kj handoff add '' --why ''`);
    expect(stripTextOnlyCommandValues(`kj handoff add '${HC}' --why 'seal the harness'`)).toBe(`kj handoff add '' --why ''`);
    // chained, the human-act guards still read it whole
    expect(stripTextOnlyCommandValues(`kj handoff add 'x' ; ${HC}`)).toContain(HC);
  });
});

describe("kj handoff add under the PreToolUse Bash hook", () => {
  let dir, pre;
  const bash = (command) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }), encoding: "utf8", cwd: dir, env: { ...process.env } });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-handoff-text-"));
    execSync("git init -q -b fix/KJC-BUG-0001-x", { cwd: dir });
    installSentinelHooks({ projectDir: dir });
    placeGuardCopies(dir);
    pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("registers a command with spaces and one that names a human act", () => {
    for (const cmd of [`kj handoff add 'bash /tmp/a b/p.sh' --why 'publish kj'`, `kj handoff add '${HC}' --why 'seal the harness'`]) {
      const r = bash(cmd);
      expect(r.stderr, cmd).not.toMatch(/MONO-0|acto humano/);
    }
  });
});

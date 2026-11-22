// HU-4781 (#4770): a hook that governs nothing (stage: true) must never block. An installed
// kj-hook older than the wiring answers an unknown guard with exit 2, and on UserPromptSubmit
// that killed every prompt. Governing entries keep blocking on an unknown guard.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { guardCommand, mergeClaudeHooks, withoutKjHooks } from "../../src/harden/harness-hooks.js";
import { SENTINEL_WIRING } from "../../src/harden/sentinel-hooks.js";

let dir, bin;
const sh = (command) => spawnSync("sh", ["-c", command], { input: "{}", encoding: "utf8", env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } });
const settingsFile = () => path.join(dir, ".claude", "settings.local.json");
const commandsOf = (hooks, event, matcher) => (hooks[event] ?? []).filter((e) => e.matcher === matcher).flatMap((e) => e.hooks.map((h) => h.command));
const merge = () => mergeClaudeHooks({ projectDir: dir, logger: { info() {}, warn() {} }, entries: SENTINEL_WIRING, viaKj: false, moveShared: false, gitIgnore: false });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-stage-"));
  bin = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fakebin-"));
  // A kj-hook (and kj) that does not know the guard: exit 2, as bin/kj-hook.js does.
  for (const name of ["kj-hook", "kj"]) fs.writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 2\n", { mode: 0o755 });
});
afterEach(() => [dir, bin].forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("a stage hook fails open", () => {
  it("ends its guard call with || true and passes when the installed runner exits 2", () => {
    for (const viaKj of [false, true]) {
      const command = guardCommand("presence", { viaKj, failOpen: true });
      expect(command).toContain(viaKj ? "then kj sentinel hook presence || true;" : "then kj-hook presence || true;");
      expect(sh(command).status).toBe(0);
    }
  });

  it("never adds exit 2 when the runner is not on the PATH", () => {
    expect(guardCommand("presence", { blocking: true, viaKj: false, failOpen: true })).not.toContain("exit 2");
  });

  it("a governing hook still blocks with that same failing kj-hook", () => {
    expect(sh(guardCommand("stop", { viaKj: false })).status).toBe(2);
  });
});

describe("kj harden rewires a project wired with the old stage form", () => {
  it("replaces the blocking stage commands, with no duplicate and governing hooks untouched", () => {
    const old = (guard) => ({ type: "command", command: guardCommand(guard, { viaKj: false }) });
    fs.mkdirSync(path.join(dir, ".claude"));
    fs.writeFileSync(settingsFile(), JSON.stringify({ hooks: {
      UserPromptSubmit: [{ hooks: [old("presence")] }],
      PostToolUse: [{ matcher: "Bash", hooks: [old("posttooluse")] }, { matcher: "Agent|Task", hooks: [old("posttooluse")] }],
    } }));
    merge();
    const { hooks } = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    expect(commandsOf(hooks, "UserPromptSubmit")).toEqual([guardCommand("presence", { viaKj: false, failOpen: true })]);
    expect(commandsOf(hooks, "PostToolUse", "Agent|Task")).toEqual([guardCommand("posttooluse", { viaKj: false, failOpen: true })]);
    expect(commandsOf(hooks, "PostToolUse", "Bash")).toEqual([guardCommand("posttooluse", { viaKj: false })]);
    expect(sh(commandsOf(hooks, "UserPromptSubmit")[0]).status).toBe(0);
    expect(sh(commandsOf(hooks, "Stop")[0]).status).toBe(2);
  });

  it("withoutKjHooks recognises the fail-open form as kj's", () => {
    merge();
    const settings = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    expect(withoutKjHooks(settings, SENTINEL_WIRING)).toBe(true);
    expect(settings.hooks).toEqual({});
  });
});

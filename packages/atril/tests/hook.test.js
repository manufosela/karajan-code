// ADR 0021 decision 14, plan step 13d1-i: a cached plugin's command hooks are listed with
// stable ids. Reads a temp directory; spawns nothing.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookEntries, hookId } from "../src/hook.js";

describe("hookId", () => {
  const base = { type: "command", command: "echo hi", args: ["a"], shell: "bash", timeout: 5 };

  it("is 12 lowercase hex characters", () => {
    expect(hookId(base)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable across key order", () => {
    expect(hookId({ timeout: 5, shell: "bash", args: ["a"], command: "echo hi" })).toBe(hookId(base));
  });

  it.each([
    ["command", { command: "echo bye" }],
    ["args", { args: ["b"] }],
    ["shell", { shell: undefined }],
    ["timeout", { timeout: 6 }],
  ])("changes when %s changes", (_field, change) => {
    expect(hookId({ ...base, ...change })).not.toBe(hookId(base));
  });

  it("ignores if, statusMessage and async", () => {
    expect(hookId({ ...base, if: "Bash(git*)", statusMessage: "x", async: true })).toBe(hookId(base));
  });
});

describe("hookEntries", () => {
  let dir;
  const manifest = (extra = {}) => {
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "demo", ...extra }));
  };
  const hooks = (value) => {
    mkdirSync(join(dir, "hooks"), { recursive: true });
    writeFileSync(join(dir, "hooks", "hooks.json"), JSON.stringify(value));
  };
  const cmd = (command, extra) => ({ type: "command", command, ...extra });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atril-hook-"));
    manifest();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is empty without hooks/hooks.json", () => {
    expect(hookEntries(dir)).toEqual({ hooks: [], skipped: [] });
  });

  it("lists handlers in file order with event and matcher", () => {
    hooks({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [cmd("a"), cmd("b")] }, { hooks: [cmd("c")] }],
        Stop: [{ hooks: [cmd("d")] }],
      },
    });
    const { hooks: found, skipped } = hookEntries(dir);
    expect(found.map(({ event, matcher, handler }) => [event, matcher, handler.command])).toEqual([
      ["PreToolUse", "Bash", "a"],
      ["PreToolUse", "Bash", "b"],
      ["PreToolUse", undefined, "c"],
      ["Stop", undefined, "d"],
    ]);
    expect(found[0].id).toBe(hookId(found[0].handler));
    expect(skipped).toEqual([]);
  });

  it("gives the same id to one handler under two events", () => {
    hooks({ hooks: { Stop: [{ hooks: [cmd("a")] }], SessionEnd: [{ hooks: [cmd("a")] }] } });
    const { hooks: found } = hookEntries(dir);
    expect(found).toHaveLength(2);
    expect(found[0].id).toBe(found[1].id);
  });

  it("reports non-command handlers as skipped, never drops them", () => {
    hooks({ hooks: { Stop: [{ matcher: "m", hooks: [{ type: "prompt", prompt: "p" }, cmd("a")] }] } });
    const { hooks: found, skipped } = hookEntries(dir);
    expect(found).toHaveLength(1);
    expect(skipped).toEqual([{ event: "Stop", matcher: "m", type: "prompt", reason: "not a command hook" }]);
  });

  it.each([
    [[], "hooks.json: must be an object"],
    [{ hooks: { Stop: {} } }, "hooks.Stop: must be a list"],
    [{}, "hooks: must be an object"],
    [{ hooks: { Stop: [5] } }, "hooks.Stop[0]: must be an object"],
    [{ hooks: { Stop: [{}] } }, "hooks.Stop[0].hooks: must be a list"],
    [{ hooks: { Stop: [{ matcher: 1, hooks: [] }] } }, "hooks.Stop[0]: matcher must be a string"],
    [{ hooks: { Stop: [{ hooks: [cmd("a", { args: "x" })] }] } }, "args must be a list of strings"],
    [{ hooks: { Stop: [{ hooks: [cmd("a", { timeout: "5" })] }] } }, "timeout must be a positive number"],
    [{ hooks: { Stop: [{ hooks: [cmd("a", { shell: "zsh" })] }] } }, 'shell "zsh" must be "bash"'],
    [{ hooks: { Stop: [{ hooks: [{ type: "command", command: "a" }, 5] }] } }, "hooks.Stop[0].hooks[1]: must be an object"],
    [{ hooks: { Stop: [{ hooks: [{ command: "a" }] }] } }, "hooks.Stop[0].hooks[0]: type must be a string"],
    [{ hooks: { Stop: [{ hooks: [cmd("")] }] } }, "hooks.Stop[0].hooks[0]: command must be a non-empty string"],
    [{ hooks: { Stop: [{ hooks: [cmd("a", { args: [1] })] }] } }, "hooks.Stop[0].hooks[0]: args must be a list of strings"],
    [{ hooks: { Stop: [{ hooks: [cmd("a", { timeout: 0 })] }] } }, "hooks.Stop[0].hooks[0]: timeout must be a positive number"],
    [{ hooks: { Stop: [{ hooks: [cmd("a", { shell: "powershell" })] }] } }, "hooks.Stop[0].hooks[0]: shell powershell is not supported yet"],
  ])("throws naming the place: %j", (value, message) => {
    hooks(value);
    expect(() => hookEntries(dir)).toThrow(message);
  });

  it("throws on a .codex-plugin copy: native-only", () => {
    rmSync(join(dir, ".claude-plugin"), { recursive: true });
    mkdirSync(join(dir, ".codex-plugin"));
    writeFileSync(join(dir, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "demo" }));
    expect(() => hookEntries(dir)).toThrow("native-only");
  });

  it("throws on hooks declared in plugin.json", () => {
    manifest({ hooks: "./h.json" });
    expect(() => hookEntries(dir)).toThrow("hooks declared in plugin.json are not supported yet");
  });
});

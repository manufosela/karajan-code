import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountCommand } from "../../src/commands/account.js";
import { rescueFor, rescueKey } from "../../src/accounts/rescue.js";

const KEY = "MARKER-key-7f3a";
let home;
let lines;
const run = (args, extra = {}) => accountCommand("rescue", { provider: "claude", ...args }, {
  home, print: (line) => lines.push(line), readStdin: () => `${KEY}\n`, env: { RESCUE_VAR: KEY }, ...extra,
});
const failure = (args, extra) => { try { run(args, extra); } catch (error) { return error.message; } return null; };
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rescue-cmd-")); lines = []; });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("kj account rescue (HU-4688)", () => {
  it("says there is no key when nothing is stored", () => {
    run({});
    expect(lines).toEqual(["no rescue key for claude"]);
  });

  it("sets the key from stdin with its rules and never prints the key", () => {
    run({ keyStdin: true, limit: true, window: "22-6", roles: "coder, reviewer", models: "m1", daily: "5", monthly: "50" });
    expect(rescueKey("claude", { home })).toBe(KEY);
    expect(rescueFor("claude", { home }).rules).toEqual({
      when: { limit: true, window: { from: 22, to: 6 } }, roles: ["coder", "reviewer"], models: ["m1"], dailyBudget: 5, monthlyBudget: 50,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^✓ rescue rules for claude: .*key set$/);
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("reads the key from an environment variable", () => {
    run({ keyEnv: "RESCUE_VAR" });
    expect(rescueKey("claude", { home })).toBe(KEY);
  });

  it("changes one rule, keeping the key and the other rules, merging when field by field", () => {
    run({ keyStdin: true, limit: true, roles: "coder" });
    run({ window: "1-5" });
    run({ roles: "reviewer" });
    expect(rescueKey("claude", { home })).toBe(KEY);
    expect(rescueFor("claude", { home }).rules).toEqual({ when: { limit: true, window: { from: 1, to: 5 } }, roles: ["reviewer"] });
  });

  it("shows hasKey and the rules without the key", () => {
    run({ keyStdin: true, daily: "3" });
    lines = [];
    run({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("key set");
    expect(lines[0]).toContain("daily 3");
    expect(lines[0]).not.toContain(KEY);
  });

  it("fails loudly with no stored key and no key source", () => {
    expect(failure({ limit: true })).toMatch(/no key stored for claude/);
  });

  it("fails when both key sources are given, without leaking the key", () => {
    const message = failure({ keyStdin: true, keyEnv: "RESCUE_VAR" });
    expect(message).toMatch(/exclusive/);
    expect(message).not.toContain(KEY);
  });

  it("fails on a bad window, an empty list and an unset variable", () => {
    expect(failure({ keyStdin: true, window: "night" })).toMatch(/--window/);
    expect(failure({ keyStdin: true, window: "6-6" })).toMatch(/window/);
    expect(failure({ keyStdin: true, roles: "a,,b" })).toMatch(/--roles/);
    expect(failure({ keyEnv: "NOT_SET" })).toMatch(/NOT_SET is not set/);
    expect(rescueFor("claude", { home }).hasKey).toBe(false);
  });

  it("removes the entry, and removing nothing is quiet", () => {
    run({ keyStdin: true });
    run({ remove: true });
    expect(rescueFor("claude", { home }).hasKey).toBe(false);
    run({ remove: true });
    expect(lines.at(-1)).toBe("✓ rescue key for claude removed");
    expect(lines.join("\n")).not.toContain(KEY);
  });
});

// KJC-TSK-0946 (MDR-C2, ADR 0016): the rules hook, end to end. Every tool call,
// MCP ones included, passes the compiled rules before it runs. Real hook, real kj.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks, verifySentinelScripts } from "../../src/harden/sentinel-hooks.js";

// The hook spawns `kj` from PATH; CI has no global kj, so a shim points at this checkout.
const KJ_BIN = path.resolve("bin/kj.js");
const SPRINT = "mcp__planning-game-personal__create_sprint";
const RULES = `version: 1
rules:
  - id: R-a1b2c3d4e5
    source: CLAUDE.md
    text: "Sprints: uno por día."
    kind: deterministic
    when:
      tool: "mcp__planning-game*__create_sprint"
      any:
        - { arg: allowLongSprint, equals: true }
        - { arg: endDate, days_from: startDate, gt: 0 }
    message: "Un sprint dura un día."
`;

let dir, home, bin, hook;
const shim = (body) => fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
const call = (tool_name, tool_input, env = {}) => spawnSync("node", [hook], {
  input: JSON.stringify({ session_id: "s1", tool_name, tool_input }),
  encoding: "utf8", cwd: dir, timeout: 120_000,
  env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, KARAJAN_HOME: home, ...env },
});
const writeRules = (text) => fs.writeFileSync(path.join(dir, ".karajan", "rules.yml"), text);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-hook-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-home-"));
  bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  shim(`exec node "${KJ_BIN}" "$@"`);
  fs.writeFileSync(path.join(home, "kj.config.yml"), "base_branch: main\n");
  execSync("git init -q -b main", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  hook = path.join(dir, ".karajan", "harness", "pretooluse-rules.mjs");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("rules hook (PreToolUse, every tool)", () => {
  it("is installed with its gate module and wired with no matcher, so MCP tools pass through it", () => {
    for (const f of ["pretooluse-rules.mjs", "sentinel-rules.mjs"]) expect(fs.existsSync(path.join(dir, ".karajan", "harness", f)), f).toBe(true);
    const { hooks } = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const entry = hooks.PreToolUse.find((e) => JSON.stringify(e).includes("pretooluse-rules.mjs"));
    expect(entry).toBeDefined();
    expect(entry.matcher).toBeUndefined();
    expect(verifySentinelScripts({ projectDir: dir }).ok).toBe(true);
  });

  it("denies a week-long sprint through the MCP tool, citing the rule, its MD and the guide", () => {
    writeRules(RULES);
    const res = call(SPRINT, { projectId: "X", startDate: "2026-10-05", endDate: "2026-10-11" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/karajan sentinel: regla R-a1b2c3d4e5 \(CLAUDE\.md\): Un sprint dura un día\./);
    expect(res.stderr).toContain("guides/sentinel/#rules");
    expect(res.stderr).not.toContain("KJ_ALLOW");
    expect(call(SPRINT, { projectId: "X", allowLongSprint: true }).status).toBe(2);
  });

  it("lets through what no rule forbids: a one-day sprint, another tool, a large Write", () => {
    writeRules(RULES);
    expect(call(SPRINT, { projectId: "X", startDate: "2026-10-05", endDate: "2026-10-05" }).status).toBe(0);
    expect(call("Read", { file_path: path.join(dir, "a.js") }).status).toBe(0);
    // The input travels on stdin: 300 KB would not fit in one argument.
    expect(call("Write", { file_path: path.join(dir, "big.txt"), content: "x".repeat(300_000) }).status).toBe(0);
  });

  it("without rules.yml it never runs kj", () => {
    shim("exit 1");
    expect(call(SPRINT, { allowLongSprint: true }).status).toBe(0);
  });

  it("an invalid rules.yml denies every call and says why; the user's off switch still works", () => {
    writeRules("version: 1\nrules:\n  - { id: bad, kind: deterministic, when: { tool: Bash } }\n");
    const res = call("Bash", { command: "ls" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/no se puede evaluar .*id must be an inventory id/);
    expect(call("Bash", { command: "ls" }, { KJ_SENTINEL_OFF: "1" }).status).toBe(0);
  });

  it("garbage on stdin is not a tool call: it never crashes the tool flow", () => {
    writeRules(RULES);
    expect(spawnSync("node", [hook], { input: "not-json", encoding: "utf8" }).status).toBe(0);
  });
});

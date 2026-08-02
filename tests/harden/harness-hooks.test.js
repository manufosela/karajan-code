// KJC-TSK-0710 — the TOOL gate: rules imposed at tool time, not remembered.
// Field case 2026-08-02: "instructions weren't enough — the environment must
// impose them" (the offending agent's own advice). Tests run the REAL script
// through the hooks protocol (JSON on stdin, exit 2 = block).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { installHarnessHooks } from "../../src/harden/harness-hooks.js";

let dir, script;
const runHook = (payload, env = {}) =>
  spawnSync("node", [script], { input: JSON.stringify(payload), encoding: "utf8", env: { ...process.env, ...env } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-toolgate-"));
  installHarnessHooks({ projectDir: dir });
  script = path.join(dir, ".karajan", "harness", "pretooluse.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("pretooluse script", () => {
  it("blocks Write over an EXISTING file (use Edit), allows new files and the named escape", () => {
    const existing = path.join(dir, "a.js");
    fs.writeFileSync(existing, "x");
    const blocked = runHook({ tool_name: "Write", tool_input: { file_path: existing } });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/Edit/);
    expect(runHook({ tool_name: "Write", tool_input: { file_path: path.join(dir, "new.js") } }).status).toBe(0);
    expect(runHook({ tool_name: "Write", tool_input: { file_path: existing } }, { KJ_ALLOW_WRITE: "1" }).status).toBe(0);
  });

  it("blocks Bash that reserializes JSON to disk, allows benign bash and the escape", () => {
    const cmd = { tool_name: "Bash", tool_input: { command: "python3 -c 'import json; json.dump(d, open(\"cfg.json\",\"w\"))'" } };
    const blocked = runHook(cmd);
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/rewrit|puntuales|Edit/i);
    expect(runHook({ tool_name: "Bash", tool_input: { command: "python3 -c 'import json; print(json.dumps(d))'" } }).status).toBe(0);
    expect(runHook({ tool_name: "Bash", tool_input: { command: "ls -la" } }).status).toBe(0);
    expect(runHook(cmd, { KJ_ALLOW_REWRITE: "1" }).status).toBe(0);
  });

  it("never crashes the tool flow on garbage input (fail open with exit 0)", () => {
    expect(spawnSync("node", [script], { input: "not-json", encoding: "utf8" }).status).toBe(0);
  });
});

describe("installHarnessHooks settings merge", () => {
  it("is idempotent and preserves the user's existing settings", () => {
    const settings = path.join(dir, ".claude", "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { PreToolUse: [{ matcher: "Grep", hooks: [{ type: "command", command: "echo mine" }] }] } }));
    installHarnessHooks({ projectDir: dir });
    installHarnessHooks({ projectDir: dir });
    const cfg = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(cfg.model).toBe("opus");
    const all = JSON.stringify(cfg.hooks.PreToolUse);
    expect(all).toContain("echo mine");
    expect((all.match(/pretooluse\.mjs/g) || []).length).toBe(2); // Write + Bash, once each
  });
});

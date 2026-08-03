// KJC-TSK-0713 SEN-A — the Sentinel: per-session method state (PostToolUse).
// Tests run the REAL script through the hooks protocol (JSON on stdin),
// inside a throwaway git repo. The Stop gate that consumes this state is the
// next slice of the card.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, postScript, statePath;
const run = (script, payload, env = {}) =>
  spawnSync("node", [script], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
const editTool = (file, session = "s1") => ({ session_id: session, tool_name: "Edit", tool_input: { file_path: file } });
const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-"));
  execSync(
    "git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0001-demo",
    { cwd: dir },
  );
  installSentinelHooks({ projectDir: dir });
  postScript = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("posttooluse script (state writer)", () => {
  it("records source edits and test edits separately, per session", () => {
    expect(run(postScript, editTool(path.join(dir, "src", "a.js"))).status).toBe(0);
    expect(run(postScript, editTool(path.join(dir, "tests", "a.test.js"))).status).toBe(0);
    expect(run(postScript, editTool(path.join(dir, "README.md"))).status).toBe(0);
    const s = state().sessions.s1;
    expect(s.edited_sources).toEqual(["src/a.js"]);
    expect(s.edited_tests).toEqual(["tests/a.test.js"]);
  });

  it("records used KJ_ALLOW_* escapes and never crashes on garbage input", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")), { KJ_ALLOW_NO_CARD: "1" });
    expect(state().sessions.s1.escapes).toContain("KJ_ALLOW_NO_CARD");
    expect(run(postScript, "not-json").status).toBe(0);
  });
});

describe("installSentinelHooks settings merge", () => {
  it("wires PostToolUse idempotently, preserving the user's entries", () => {
    const settings = path.join(dir, ".claude", "settings.json");
    const mine = { matcher: "Grep", hooks: [{ type: "command", command: "echo mine" }] };
    fs.writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { PostToolUse: [mine] } }));
    installSentinelHooks({ projectDir: dir });
    installSentinelHooks({ projectDir: dir });
    const cfg = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(cfg.model).toBe("opus");
    expect(JSON.stringify(cfg.hooks.PostToolUse)).toContain("echo mine");
    expect((JSON.stringify(cfg.hooks.PostToolUse).match(/posttooluse\.mjs/g) || []).length).toBe(1);
  });

  it("leaves a non-array hook event untouched and reports script-only", () => {
    const settings = path.join(dir, ".claude", "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ hooks: { PostToolUse: { weird: true } } }));
    const res = installSentinelHooks({ projectDir: dir });
    expect(res.wired).toBe(false);
    expect(JSON.parse(fs.readFileSync(settings, "utf8")).hooks.PostToolUse).toEqual({ weird: true });
  });
});

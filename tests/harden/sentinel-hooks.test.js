// KJC-TSK-0713 SEN-A — the Sentinel: per-session method state (PostToolUse)
// plus a Stop hook that BLOCKS ending the turn while violations are open.
// Tests run the REAL scripts through the hooks protocol (JSON on stdin,
// exit 2 = block), inside a throwaway git repo.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, postScript, stopScript, statePath;
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
  stopScript = path.join(dir, ".karajan", "harness", "stop.mjs");
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

describe("stop script (turn cannot end red)", () => {
  it("blocks when sources were edited without touching a single test, then passes once a test is touched", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    const blocked = run(stopScript, { session_id: "s1" });
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/test/i);
    run(postScript, editTool(path.join(dir, "tests", "a.test.js")));
    expect(run(stopScript, { session_id: "s1" }).status).toBe(0);
  });

  it("blocks on the base branch and on a branch without a card ref, with remediation in the message", () => {
    execSync("git checkout -q main", { cwd: dir });
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    run(postScript, editTool(path.join(dir, "tests", "a.test.js")));
    const onMain = run(stopScript, { session_id: "s1" });
    expect(onMain.status).toBe(2);
    expect(onMain.stderr).toMatch(/rama base|base branch/i);
    execSync("git checkout -q -b sin-card", { cwd: dir });
    const noCard = run(stopScript, { session_id: "s1" });
    expect(noCard.status).toBe(2);
    expect(noCard.stderr).toMatch(/card/i);
  });

  it("ends the turn normally when nothing was edited, on escape, and on garbage input", () => {
    expect(run(stopScript, { session_id: "empty" }).status).toBe(0);
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    expect(run(stopScript, { session_id: "s1" }, { KJ_SENTINEL_OFF: "1" }).status).toBe(0);
    expect(run(stopScript, "not-json").status).toBe(0);
  });

  it("fails OPEN after 3 consecutive blocks (a sentinel bug never bricks the session) and records it", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    for (let i = 0; i < 3; i++) expect(run(stopScript, { session_id: "s1" }).status).toBe(2);
    const open = run(stopScript, { session_id: "s1" });
    expect(open.status).toBe(0);
    expect(state().sessions.s1.errors.join(" ")).toMatch(/fail-open/);
  });

  it("--status prints the state without blocking", () => {
    run(postScript, editTool(path.join(dir, "src", "a.js")));
    const res = spawnSync("node", [stopScript, "--status"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/src\/a\.js/);
  });
});

describe("installSentinelHooks settings merge", () => {
  it("wires PostToolUse and Stop idempotently, preserving the user's entries", () => {
    const settings = path.join(dir, ".claude", "settings.json");
    const mine = { matcher: "Grep", hooks: [{ type: "command", command: "echo mine" }] };
    fs.writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { PostToolUse: [mine] } }));
    installSentinelHooks({ projectDir: dir });
    installSentinelHooks({ projectDir: dir });
    const cfg = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(cfg.model).toBe("opus");
    expect(JSON.stringify(cfg.hooks.PostToolUse)).toContain("echo mine");
    expect((JSON.stringify(cfg.hooks.PostToolUse).match(/posttooluse\.mjs/g) || []).length).toBe(1);
    expect((JSON.stringify(cfg.hooks.Stop).match(/stop\.mjs/g) || []).length).toBe(1);
  });

  it("leaves a non-array hook event untouched and reports script-only", () => {
    const settings = path.join(dir, ".claude", "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: { weird: true } } }));
    const res = installSentinelHooks({ projectDir: dir });
    expect(res.wired).toBe(false);
    expect(JSON.parse(fs.readFileSync(settings, "utf8")).hooks.Stop).toEqual({ weird: true });
  });
});

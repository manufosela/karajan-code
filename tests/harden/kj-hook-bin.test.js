// KJC-TSK-1203 (ADR 0030, step 4): kj-hook runs one Sentinel guard from the package.
// The wiring names the guard; anything outside the closed list blocks (exit 2),
// because a hook that names no known guard is a wiring nobody can trust.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../bin/kj-hook.js", import.meta.url));
const PKG = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

const run = (args, { cwd, input = "{}" }) => {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: cwd, KJ_SENTINEL_OFF: "" };
  return spawnSync(process.execPath, [BIN, ...args], { cwd, env, input, encoding: "utf8" });
};

describe("kj-hook", () => {
  let repo;
  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-hook-")));
    execFileSync("git", ["init", "-q", repo]);
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("is published as a bin of the package", () => {
    expect(PKG.bin["kj-hook"]).toBe("bin/kj-hook.js");
  });

  it.each([["nope"], ["../../package"], ["posttooluse.mjs"], [""]])("refuses %j and blocks", (name) => {
    const r = run([name], { cwd: repo });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/kj-hook/);
  });

  it("refuses a call with no guard at all", () => {
    expect(run([], { cwd: repo }).status).toBe(2);
  });

  it("runs a known guard against the project it is given, with its state there", () => {
    const r = run(["posttooluse"], { cwd: repo, input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(repo, "src", "a.js") } }) });
    expect(r.status).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(repo, ".karajan", "harness", "sentinel-state.json"), "utf8"));
    expect(state.sessions.s1.edited_sources).toEqual(["src/a.js"]);
  });
});

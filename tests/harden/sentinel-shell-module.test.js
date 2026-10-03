// KJC-TSK-0915 (SNT-A, ADR 0014): the Sentinel's shell reader is a real module,
// tested by unit, and kj harden copies it byte for byte into the harness.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { shellSegments, headIndex, shortOpts } from "../../src/harden/sentinel/sentinel-shell.mjs";
import { installSentinelHooks, canonicalHarnessBody, verifySentinelScripts } from "../../src/harden/sentinel-hooks.js";

describe("shellSegments", () => {
  it("cuts simple commands at operators, newlines, groups and substitutions", () => {
    expect(shellSegments("a b && c;d | e\nf")).toEqual([["a", "b"], ["c"], ["d"], ["e"], ["f"]]);
    expect(shellSegments("echo $(touch x) (y) { z; }")).toEqual([["echo", "$"], ["touch", "x"], ["y"], ["z"]]);
  });

  it("keeps quoted operators, blanks and escaped blanks inside the word", () => {
    expect(shellSegments("git checkout -- 'user;work.txt' \"my notes.md\" my\\ file")).toEqual([["git", "checkout", "--", "user;work.txt", "my notes.md", "my file"]]);
  });

  it("reads redirections as their own words, >| and >& included", () => {
    expect(shellSegments("echo x>f")).toEqual([["echo", "x", ">f"]]);
    expect(shellSegments("echo x >| f 2>&1")).toEqual([["echo", "x", ">|", "f", "2>&1"]]);
  });

  it("marks the word a backtick interrupts as unreadable", () => {
    expect(shellSegments("touch `echo .`/f")[0]).toEqual(["touch", "$"]);
  });
});

describe("headIndex", () => {
  it("skips assignments and wrappers in any order, and a wrapper's options up to a known head", () => {
    expect(headIndex(["env", "MODE=prod", "tee", "f"], [])).toBe(2);
    expect(headIndex(["/usr/bin/env", "tee"], [])).toBe(1);
    expect(headIndex(["sudo", "-u", "root", "git", "reset"], ["git"])).toBe(3);
    expect(headIndex(["sudo", "-u", "root"], ["git"])).toBe(3);
  });
});

describe("shortOpts", () => {
  it("stops a short cluster at e: the rest is -e's value", () => {
    expect(shortOpts("-fen")).toBe("f");
    expect(shortOpts("-xdf")).toBe("xdf");
    expect(shortOpts("--force")).toBe("");
  });
});

describe("installed into the harness", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-shell-mod-"));
    execSync("git init -q -b main", { cwd: dir });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes sentinel-shell.mjs byte for byte, records it, and the PreToolUse imports it", () => {
    installSentinelHooks({ projectDir: dir });
    const harness = path.join(dir, ".karajan", "harness");
    const source = fs.readFileSync(new URL("../../src/harden/sentinel/sentinel-shell.mjs", import.meta.url), "utf8");
    expect(fs.readFileSync(path.join(harness, "sentinel-shell.mjs"), "utf8")).toBe(source);
    expect(canonicalHarnessBody("sentinel-shell.mjs")).toBe(source);
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(harness, "installed.json"), "utf8")).files)).toContain("sentinel-shell.mjs");
    expect(fs.readFileSync(path.join(harness, "pretooluse-sentinel.mjs"), "utf8")).toContain('from "./sentinel-shell.mjs"');
  });

  it("a guard kj never installed is new, not tampering: it is written; one kj installed and is gone still blocks", () => {
    installSentinelHooks({ projectDir: dir });
    const harness = path.join(dir, ".karajan", "harness");
    const recordPath = path.join(harness, "installed.json");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    // An install from before the module existed: no file, no record entry.
    fs.rmSync(path.join(harness, "sentinel-shell.mjs"));
    delete record.files["sentinel-shell.mjs"];
    fs.writeFileSync(recordPath, JSON.stringify(record));
    const fresh = verifySentinelScripts({ projectDir: dir, gitShowFn: () => null });
    expect(fresh).toMatchObject({ ok: true, regenerated: ["sentinel-shell.mjs"] });
    expect(fs.existsSync(path.join(harness, "sentinel-shell.mjs"))).toBe(true);
    // Installed by kj (recorded) and then deleted: that is tampering.
    fs.rmSync(path.join(harness, "sentinel-shell.mjs"));
    expect(verifySentinelScripts({ projectDir: dir, gitShowFn: () => null })).toMatchObject({ ok: false, mismatched: ["sentinel-shell.mjs"] });
  });
});

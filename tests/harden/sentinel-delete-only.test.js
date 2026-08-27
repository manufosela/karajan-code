// KJC-TSK-0795 AC1, sentinel side — a session whose source edits only REMOVED
// lines does not owe a test: deleting adds no behavior. Driven against the
// GENERATED hooks, like every sentinel suite.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, postScript, stopScript;
const run = (script, payload) =>
  spawnSync("node", [script], {
    input: JSON.stringify(payload), encoding: "utf8",
    env: { ...process.env, KJ_ALLOW_IDENTITY: "1" },
  });
const edit = (file) => ({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: file } });
const stop = () => run(stopScript, { session_id: "s1" });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-del-only-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), "line1\nline2\nline3\nline4\n");
  execSync(
    "git init -q -b main && git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -q -m init && git checkout -q -b feat/KJC-TSK-0001-demo",
    { cwd: dir },
  );
  installSentinelHooks({ projectDir: dir });
  postScript = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
  stopScript = path.join(dir, ".karajan", "harness", "stop.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("stop gate × delete-only source edits", () => {
  it("a source edit that only removes lines ends the turn without demanding a test", () => {
    fs.writeFileSync(path.join(dir, "src", "a.js"), "line1\n"); // 3 lines removed, none added
    run(postScript, edit(path.join(dir, "src", "a.js")));
    const r = stop();
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/sin tocar un solo test/);
    expect(r.status).toBe(0);
  });

  it("a source edit that ADDS lines still owes its test", () => {
    fs.writeFileSync(path.join(dir, "src", "a.js"), "line1\nline2\nline3\nline4\nnew()\n");
    run(postScript, edit(path.join(dir, "src", "a.js")));
    const r = stop();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/sin tocar un solo test/);
  });
});

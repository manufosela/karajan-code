// KJC-BUG-0238 (#1886) — whose change is it? The first time the session
// touches a file, the PreToolUse hook records whether it was clean. A change
// the session may later discard is one it made on a clean (or new) file: an
// edit on top of the user's uncommitted work leaves that file foreign.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, pre, statePath;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const edit = (rel) => spawnSync("node", [pre], {
  input: JSON.stringify({ session_id: "s1", tool_name: "Edit", tool_input: { file_path: path.join(dir, rel) } }),
  encoding: "utf8", cwd: dir, env: { ...process.env, KJ_ALLOW_IDENTITY: "1", KJ_SENTINEL_OFF: "1" },
});
const touched = () => JSON.parse(fs.readFileSync(statePath, "utf8")).sessions.s1.first_touch;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-first-touch-"));
  fs.writeFileSync(path.join(dir, "clean.md"), "a\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  execSync("git init -q -b main && git add -A && git commit -q -m init", { cwd: dir, env: { ...process.env, ...gitEnv } });
  installSentinelHooks({ projectDir: dir });
  pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("first-touch ledger (PreToolUse, before any escape)", () => {
  it("records clean for a committed file and a new one, dirty for the user's uncommitted work", () => {
    fs.appendFileSync(path.join(dir, ".gitignore"), ".karajan/identity.local.yml\n");
    fs.writeFileSync(path.join(dir, "notes.txt"), "user draft\n");
    for (const rel of ["clean.md", "new.js", ".gitignore", "notes.txt"]) edit(rel);
    expect(touched()).toEqual({ "clean.md": "clean", "new.js": "clean", ".gitignore": "dirty", "notes.txt": "dirty" });
  });

  it("keeps the FIRST state: the session's own edit does not make the file its own later", () => {
    edit("clean.md");
    fs.appendFileSync(path.join(dir, "clean.md"), "session edit\n");
    edit("clean.md");
    expect(touched()["clean.md"]).toBe("clean");
    fs.appendFileSync(path.join(dir, ".gitignore"), "user\n");
    edit(".gitignore");
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
    edit(".gitignore");
    expect(touched()[".gitignore"]).toBe("dirty");
  });

  it("an existing ignored file with the user's content is theirs, not clean", () => {
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "node_modules", "local.env"), "SECRET=user\n");
    edit("node_modules/local.env");
    expect(touched()["node_modules/local.env"]).toBe("dirty");
  });

  it("records files named like prototype keys", () => {
    fs.writeFileSync(path.join(dir, "toString"), "user\n");
    edit("toString");
    edit("__proto__");
    const t = touched();
    expect(Object.hasOwn(t, "toString") && t.toString).toBe("dirty");
    expect(Object.hasOwn(t, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(t, "__proto__").value).toBe("clean");
  });

  it("ignores paths outside the repo", () => {
    edit("clean.md");
    spawnSync("node", [pre], {
      input: JSON.stringify({ session_id: "s1", tool_name: "Write", tool_input: { file_path: path.join(os.tmpdir(), "elsewhere.md") } }),
      encoding: "utf8", cwd: dir, env: { ...process.env, KJ_ALLOW_IDENTITY: "1", KJ_SENTINEL_OFF: "1" },
    });
    expect(Object.keys(touched())).toEqual(["clean.md"]);
  });
});

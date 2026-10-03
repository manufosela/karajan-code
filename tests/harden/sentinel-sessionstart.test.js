// KJC-TSK-0918 (SNT-D, ADR 0014): after a compaction (or a resume) the agent
// gets the project's critical rules back, short, with the state of its session.
// First of them, by the user's decision (KJC-TSK-0920): Karajan governs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, hook;
const run = (source) => spawnSync("node", [hook], { input: JSON.stringify({ session_id: "s1", hook_event_name: "SessionStart", source }), encoding: "utf8", cwd: dir });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sessionstart-"));
  execSync("git init -q -b feat/KJC-TSK-0001-x && git commit -q --allow-empty -m init", { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  installSentinelHooks({ projectDir: dir });
  hook = path.join(dir, ".karajan", "harness", "sessionstart.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("SessionStart hook", () => {
  it("after compact and resume: the critical rules, Karajan governs first, and the session's state", () => {
    fs.writeFileSync(path.join(dir, ".karajan", "harness", "sentinel-state.json"), JSON.stringify({ sessions: { s1: { pending_moves: [{ card: "KJC-TSK-0002", pr: 7 }] } } }));
    for (const source of ["compact", "resume"]) {
      const r = run(source);
      expect(r.status, source).toBe(0);
      const ctx = JSON.parse(r.stdout).hookSpecificOutput;
      expect(ctx.hookEventName).toBe("SessionStart");
      const lines = ctx.additionalContext.split("\n");
      expect(lines.length).toBeLessThanOrEqual(16);
      expect(lines.find((l) => /^1\./.test(l))).toMatch(/Karajan gobierna/);
      expect(ctx.additionalContext).toContain("feat/KJC-TSK-0001-x");
      expect(ctx.additionalContext).toContain("KJC-TSK-0002 (PR #7)");
    }
  });

  it("a new session says nothing: CLAUDE.md already brings the rules", () => {
    expect(run("startup").stdout).toBe("");
  });

  it("is wired in the host settings for compact and resume", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const matchers = (cfg.hooks.SessionStart || []).filter((e) => JSON.stringify(e).includes("sessionstart.mjs")).map((e) => e.matcher);
    expect(matchers.sort()).toEqual(["compact", "resume"]);
  });
});

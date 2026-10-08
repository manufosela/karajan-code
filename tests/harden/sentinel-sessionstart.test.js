// KJC-TSK-0918 (SNT-D, ADR 0014): after a compaction (or a resume) the agent
// gets the project's critical rules back, short, with the state of its session.
// First of them, by the user's decision (KJC-TSK-0920): Karajan governs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, hook, fakeBin;
// A fake kj at the front of PATH: the hook relays what kj says and the suite
// never depends on the linked kj (KJ_FAKE_INVITE: a file whose text is the invitation).
const run = (source, env = {}) => spawnSync("node", [hook], { input: JSON.stringify({ session_id: "s1", hook_event_name: "SessionStart", source }), encoding: "utf8", cwd: dir, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, ...env } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sessionstart-"));
  fakeBin = path.join(dir, "fakebin");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, "kj"), '#!/bin/sh\nif [ "$1" = identity ] && [ -n "$KJ_FAKE_INVITE" ]; then cat "$KJ_FAKE_INVITE"; fi\n', { mode: 0o755 });
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

  // KJC-TSK-0986 (HUM-F): the once-per-version invitation to enroll the phone,
  // decided and remembered by kj; the hook only relays it.
  it("a new session relays kj's invitation to enroll the phone, when kj says so", () => {
    const invite = path.join(dir, "invite.txt");
    fs.writeFileSync(invite, "El móvil no está enrolado: enrólalo con kj identity enroll-phone.\n");
    const r = run("startup", { KJ_FAKE_INVITE: invite });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe("Karajan: El móvil no está enrolado: enrólalo con kj identity enroll-phone.");
  });

  // KJC-TSK-0949 (MDR-E2): a fake kj at the front of the PATH answers the coverage.
  it("with rules.yml, every session start names the rules with no gate; a new session gets only that", () => {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\necho '{"counts":{"none":3,"stale":0}}'\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, ".karajan", "rules.yml"), "version: 1\nrules: []\n");
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const context = (source) => {
      const r = spawnSync("node", [hook], { input: JSON.stringify({ session_id: "s1", source }), encoding: "utf8", cwd: dir, env });
      return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    };
    expect(context("startup")).toMatch(/^Karajan: 3 sin gate/);
    expect(context("startup")).not.toMatch(/Karajan gobierna/);
    expect(context("compact")).toMatch(/Karajan gobierna[\s\S]*3 sin gate/);
  });

  it("is wired in the host settings for startup, compact and resume", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"));
    const matchers = (cfg.hooks.SessionStart || []).filter((e) => JSON.stringify(e).includes("sessionstart.mjs")).map((e) => e.matcher);
    expect(matchers.sort()).toEqual(["compact", "resume", "startup"]);
  });
});

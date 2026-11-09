// KJC-TSK-1475: the agent minds what waits for its user. At the turn's end, at most once
// every 30 min, the Stop hook has it check the pending handoffs, close the stale ones and
// end with the rest; a blocking one stops every action but reading, asking and kj handoff.
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { blockingDeny, pendingHandoffs, REMIND_EVERY_MS, reminderDue } from "../../src/harden/sentinel/sentinel-handoffs.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

let dir, fakeBin;
const box = (...p) => path.join(dir, ".karajan", "handoffs", ...p);
const handoff = (id, extra = {}) => fs.writeFileSync(box(`${id}.json`), JSON.stringify({ id, command: "npm publish", status: "pending", createdAt: "2026-11-09T10:00:00Z", blocking: false, ...extra }));
// The guards' own kj calls (verify, claims) answer from a fake: these tests never depend on the linked kj.
const env = () => ({ ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` });
const hook = (name, payload) => spawnSync("node", [path.join(dir, ".karajan", "harness", name)], { input: JSON.stringify({ session_id: "s1", cwd: dir, ...payload }), encoding: "utf8", cwd: dir, env: env() });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-handoffs-"));
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fake-bin-"));
  fs.writeFileSync(path.join(fakeBin, "kj"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  execSync("git init -q -b main && git checkout -q -b feat/KJC-TSK-0001-x", { cwd: dir });
  installSentinelHooks({ projectDir: dir });
  placeGuardCopies(dir);
  fs.mkdirSync(box(), { recursive: true });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fakeBin, { recursive: true, force: true }); });

describe("the pending handoffs", () => {
  it("are the pending ones, oldest first; done, unreadable or foreign files do not count", () => {
    handoff("bbbbbbbb", { createdAt: "2026-11-09T11:00:00Z" });
    handoff("aaaaaaaa");
    handoff("cccccccc", { status: "done" });
    fs.writeFileSync(box("dddddddd.json"), "{broken");
    fs.writeFileSync(box("notes.json"), JSON.stringify({ status: "pending", command: "x" }));
    expect(pendingHandoffs(dir).map((h) => h.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(pendingHandoffs(path.join(dir, "nowhere"))).toEqual([]);
  });

  it("are due a reminder with nothing said yet or 30 min after the last one", () => {
    const one = [{ id: "a" }];
    expect(reminderDue([], undefined, 0)).toBe(false);
    expect(reminderDue(one, undefined, 0)).toBe(true);
    expect(reminderDue(one, 1000, 1000 + REMIND_EVERY_MS - 1)).toBe(false);
    expect(reminderDue(one, 1000, 1000 + REMIND_EVERY_MS)).toBe(true);
  });

  it("a blocking one denies acting, but not reading, asking or kj handoff alone", () => {
    const pending = [{ id: "a", command: "kj harden --commit", blocking: true }];
    expect(blockingDeny([{ id: "a", command: "x", blocking: false }], "Bash", { command: "npm test" })).toBeNull();
    expect(blockingDeny(pending, "Bash", { command: "npm test" })).toMatch(/BLOQUEANTE[\s\S]*kj harden --commit/);
    expect(blockingDeny(pending, "Edit", { file_path: "a.js" })).toMatch(/BLOQUEANTE/);
    for (const tool of ["Read", "Grep", "Glob", "AskUserQuestion"]) expect(blockingDeny(pending, tool, {})).toBeNull();
    expect(blockingDeny(pending, "Bash", { command: "kj handoff done a" })).toBeNull();
    expect(blockingDeny(pending, "Bash", { command: "kj handoff done a && npm test" })).toMatch(/BLOQUEANTE/);
  });
});

describe("the hooks", () => {
  it("the turn's end is held once with the reminder, and lets go until 30 min have passed", () => {
    handoff("aaaaaaaa", { why: "publicar la 5.10" });
    const first = hook("stop.mjs", {});
    expect(first.status).toBe(2);
    expect(first.stderr).toMatch(/aaaaaaaa: npm publish \(publicar la 5\.10\)[\s\S]*ÚLTIMAS líneas/);
    expect(hook("stop.mjs", {}).status).toBe(0);
  });

  it("without pending handoffs the turn ends as before", () => {
    handoff("aaaaaaaa", { status: "done" });
    expect(hook("stop.mjs", {}).status).toBe(0);
  });

  it("a blocking handoff stops the next action; one that is not leaves the work going", () => {
    handoff("aaaaaaaa");
    expect(hook("pretooluse-sentinel.mjs", { tool_name: "Bash", tool_input: { command: "git status" } }).status).toBe(0);
    handoff("bbbbbbbb", { blocking: true, command: "kj harden --commit" });
    const r = hook("pretooluse-sentinel.mjs", { tool_name: "Bash", tool_input: { command: "git status" } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/BLOQUEANTE[\s\S]*bbbbbbbb: kj harden --commit/);
    expect(hook("pretooluse-sentinel.mjs", { tool_name: "Bash", tool_input: { command: "kj handoff done bbbbbbbb" } }).status).toBe(0);
  });
});

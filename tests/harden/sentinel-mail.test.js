// HU-4210: the Stop hook reminds that link mail waits, from a file the board wrote: no kj, no network.
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAIL_STALE_MS, takeMailReminder, unreadMail } from "../../src/harden/sentinel/sentinel-mail.mjs";
import { REMIND_EVERY_MS } from "../../src/harden/sentinel/sentinel-handoffs.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";
let dir, fakeBin;
const NOW = 1_800_000_000_000;
const file = () => path.join(dir, ".karajan", "link", "unread.json");
const put = (body) => { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), typeof body === "string" ? body : JSON.stringify(body)); };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-mail-"));
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "kj-fake-bin-"));
  fs.writeFileSync(path.join(fakeBin, "kj"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(fakeBin, { recursive: true, force: true }); });
describe("unreadMail", () => {
  it("returns the count of a fresh file", () => { put({ unread: 3, at: NOW - 1000 }); expect(unreadMail(dir, NOW)).toBe(3); });
  it("ignores a file older than 2 hours", () => { put({ unread: 3, at: NOW - MAIL_STALE_MS - 1 }); expect(unreadMail(dir, NOW)).toBe(0); });
  it("ignores a non-integer count, a broken file and a missing one", () => {
    put({ unread: 1.5, at: NOW }); expect(unreadMail(dir, NOW)).toBe(0);
    put({ unread: "3", at: NOW }); expect(unreadMail(dir, NOW)).toBe(0);
    put("{broken"); expect(unreadMail(dir, NOW)).toBe(0);
    fs.rmSync(file()); expect(unreadMail(dir, NOW)).toBe(0);
  });
});
describe("takeMailReminder", () => {
  it("fires once per 30 minutes, noting the time", () => {
    put({ unread: 2, at: NOW }); const state = {};
    expect(takeMailReminder(state, dir, NOW)).toMatch(/2[\s\S]*kj link inbox/);
    expect(state.mail_reminded[dir]).toBe(NOW);
    expect(takeMailReminder(state, dir, NOW + REMIND_EVERY_MS - 1)).toBeNull();
    put({ unread: 2, at: NOW + REMIND_EVERY_MS });
    expect(takeMailReminder(state, dir, NOW + REMIND_EVERY_MS)).toMatch(/kj link inbox/);
  });
  it("is silent for zero", () => { put({ unread: 0, at: NOW }); expect(takeMailReminder({}, dir, NOW)).toBeNull(); });
});
describe("the stop hook", () => {
  const stop = () => spawnSync("node", [path.join(dir, ".karajan", "harness", "stop.mjs")], { input: JSON.stringify({ session_id: "s1", cwd: dir }), encoding: "utf8", cwd: dir, env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` } });
  beforeEach(() => {
    execSync("git init -q -b main && git checkout -q -b feat/KJC-TSK-0001-x", { cwd: dir });
    installSentinelHooks({ projectDir: dir });
    placeGuardCopies(dir);
    fs.mkdirSync(path.join(dir, ".karajan", "handoffs"), { recursive: true });
    put({ unread: 2, at: Date.now() });
  });
  it("shows the mail alone, with no handoff text", () => {
    const out = stop();
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/2[\s\S]*kj link inbox/);
    expect(out.stderr).not.toMatch(/kj handoff/);
  });
  it("joins the mail to the handoff reminder when both are due", () => {
    fs.writeFileSync(path.join(dir, ".karajan", "handoffs", "aaaaaaaa.json"), JSON.stringify({ id: "aaaaaaaa", command: "npm publish", status: "pending", createdAt: "", blocking: false }));
    const out = stop();
    expect(out.stderr).toMatch(/aaaaaaaa: npm publish[\s\S]*kj link inbox/);
  });
});

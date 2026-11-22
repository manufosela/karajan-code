// HU-4750 (ADR 0064 decision 4): the memory of which accounts are out of their limit, and until when.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exhaustedUntil, limitHold, markExhausted } from "../../src/accounts/exhausted.js";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000);
let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-exhausted-")); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
const file = () => path.join(home, "exhausted.json");

describe("markExhausted and exhaustedUntil", () => {
  it("remembers an account until its time, and forgets it after", () => {
    markExhausted("work", at(30), { home, now: NOW });
    expect(exhaustedUntil("work", { home, now: NOW })).toEqual(at(30));
    expect(exhaustedUntil("work", { home, now: at(31) })).toBeNull();
  });

  it("keeps accounts independent, and an unknown one is not exhausted", () => {
    markExhausted("a", at(30), { home, now: NOW });
    expect(exhaustedUntil("b", { home, now: NOW })).toBeNull();
    markExhausted("b", at(60), { home, now: NOW });
    expect(exhaustedUntil("a", { home, now: NOW })).toEqual(at(30));
  });

  it("accepts an ISO string and rejects an invalid or past time", () => {
    markExhausted("a", at(10).toISOString(), { home, now: NOW });
    expect(exhaustedUntil("a", { home, now: NOW })).toEqual(at(10));
    expect(() => markExhausted("a", "not a date", { home, now: NOW })).toThrow(/until/);
    expect(() => markExhausted("a", at(-1), { home, now: NOW })).toThrow(/until/);
  });

  it("drops the entries that have passed when it next writes", () => {
    markExhausted("old", at(5), { home, now: NOW });
    markExhausted("new", at(90), { home, now: at(10) });
    expect(Object.keys(JSON.parse(fs.readFileSync(file(), "utf8")))).toEqual(["new"]);
  });

  it("a missing, empty or corrupt file means nothing is exhausted and never throws", () => {
    expect(exhaustedUntil("a", { home, now: NOW })).toBeNull();
    fs.writeFileSync(file(), "");
    expect(exhaustedUntil("a", { home, now: NOW })).toBeNull();
    fs.writeFileSync(file(), "{ not json");
    expect(exhaustedUntil("a", { home, now: NOW })).toBeNull();
    markExhausted("a", at(5), { home, now: NOW });
    expect(exhaustedUntil("a", { home, now: NOW })).toEqual(at(5));
  });

  it("writes only ids and dates, in a file of its own and private to the user", () => {
    markExhausted("a", at(5), { home, now: NOW });
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toEqual({ a: at(5).toISOString() });
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(home, "accounts.json"))).toBe(false);
  });
});

describe("limitHold", () => {
  const message = "You've hit your limit · resets at 2026-11-22 15:30 UTC";

  it("uses the reset time the message carries", () => {
    expect(limitHold(message, undefined, { now: NOW })).toEqual(new Date("2026-11-22T15:30:00.000Z"));
  });

  it("falls back to the account's own limit wait, then to an hour", () => {
    expect(limitHold("rate limit reached", { limitWaitSeconds: 600 }, { now: NOW })).toEqual(at(10));
    expect(limitHold("rate limit reached", { gapSeconds: 5 }, { now: NOW })).toEqual(at(60));
    expect(limitHold("rate limit reached", undefined, { now: NOW })).toEqual(at(60));
  });
});

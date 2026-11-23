import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountFor, accountsFor, addAccount, assignAccounts } from "../../src/accounts/store.js";
import { markExhausted } from "../../src/accounts/exhausted.js";

const now = new Date("2026-11-22T10:00:00Z");
const later = new Date("2026-11-22T12:00:00Z");
const earlier = new Date("2026-11-22T09:00:00Z");
let home;
let dirs;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-exh-"));
  dirs = ["a", "b"].map(() => fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-")));
});
afterEach(() => {
  for (const dir of [home, ...dirs]) fs.rmSync(dir, { recursive: true, force: true });
});

const setup = (project = "/p") => {
  addAccount({ id: "a", provider: "claude", dir: dirs[0] }, { home });
  addAccount({ id: "b", provider: "claude", dir: dirs[1] }, { home });
  assignAccounts(project, "claude", ["a", "b"], { home });
};
const pick = (projectKey = "/p") => accountFor("claude", { home, projectKey, now });

describe("accountFor skips an exhausted account (HU-4751)", () => {
  it("uses the first account when none is out, with no allExhausted key", () => {
    setup();
    const got = pick();
    expect(got.id).toBe("a");
    expect("allExhausted" in got).toBe(false);
  });

  it("uses the second when the first is exhausted", () => {
    setup();
    markExhausted("a", later, { home, now });
    const got = pick();
    expect(got.id).toBe("b");
    expect(got.env).toEqual({ CLAUDE_CONFIG_DIR: dirs[1] });
    expect("allExhausted" in got).toBe(false);
  });

  it("returns the first plus allExhausted when every account is out", () => {
    setup();
    markExhausted("a", later, { home, now });
    markExhausted("b", later, { home, now });
    const got = pick();
    expect(got.id).toBe("a");
    expect(got.allExhausted).toEqual([{ id: "a", until: later }, { id: "b", until: later }]);
  });

  it("ignores an exhaustion that has passed", () => {
    setup();
    markExhausted("a", earlier, { home, now: new Date("2026-11-22T08:00:00Z") });
    expect(pick().id).toBe("a");
  });

  it("never consults another project's order", () => {
    setup("/other");
    assignAccounts("/other", "claude", ["b"], { home });
    markExhausted("b", later, { home, now });
    const got = pick("/p");
    expect(got.id).toBe("a");
    expect("allExhausted" in got).toBe(false);
  });

  it("treats the default account as a list of one and names it when out", () => {
    addAccount({ id: "a", provider: "claude", dir: dirs[0] }, { home });
    expect(accountsFor("claude", { home }).map((x) => x.id)).toEqual(["a"]);
    markExhausted("a", later, { home, now });
    expect(pick().allExhausted).toEqual([{ id: "a", until: later }]);
  });

  it("is unchanged with no accounts at all", () => {
    expect(pick()).toEqual({ id: null, env: {}, pace: undefined });
    expect(accountsFor("claude", { home })).toEqual([]);
  });
});

describe("accountsFor (HU-4751)", () => {
  it("lists the project's order", () => {
    setup();
    expect(accountsFor("claude", { home, projectKey: "/p" }).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("fails loudly on an id left in an order after its account was removed", () => {
    setup();
    const file = path.join(home, "accounts.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.accounts = data.accounts.filter((x) => x.id !== "b");
    fs.writeFileSync(file, JSON.stringify(data));
    expect(() => accountsFor("claude", { home, projectKey: "/p" })).toThrow(/no longer exists/);
  });
});

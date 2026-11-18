import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAccount, assignAccounts } from "../../src/accounts/store.js";
import { sessionWarnings } from "../../src/accounts/session.js";

let root;
let home;
const dirOf = (name) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-session-")));
  home = dirOf("home");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("sessionWarnings (HU-4595, ADR 0064 decision 7)", () => {
  const key = "/work/proj";
  const setup = () => {
    addAccount({ id: "a", provider: "claude", dir: dirOf("a") }, { home });
    addAccount({ id: "b", provider: "claude", dir: dirOf("b") }, { home });
    assignAccounts(key, "claude", ["a", "b"], { home });
  };
  const warn = (env) => sessionWarnings({ env, projectKey: key, home });

  it("is silent when the session runs on one of the project's accounts", () => {
    setup();
    expect(warn({ CLAUDE_CONFIG_DIR: dirOf("b") })).toEqual([]);
  });
  it("names the first account of the order when the session runs elsewhere", () => {
    setup();
    const other = dirOf("other");
    expect(warn({ CLAUDE_CONFIG_DIR: other })).toEqual([
      `claude session runs on ${other}; this project uses account "a" (${path.join(root, "a")})`,
    ]);
  });
  it("is silent when the variable is unset or empty", () => {
    setup();
    expect(warn({})).toEqual([]);
    expect(warn({ CLAUDE_CONFIG_DIR: "" })).toEqual([]);
  });
  it("is silent when the project has no accounts for the provider", () => {
    expect(warn({ CLAUDE_CONFIG_DIR: dirOf("x"), CODEX_HOME: dirOf("y") })).toEqual([]);
  });
  it("compares by real path, so a symlinked dir is the same login", () => {
    setup();
    const link = path.join(root, "link");
    fs.symlinkSync(path.join(root, "a"), link);
    expect(warn({ CLAUDE_CONFIG_DIR: link })).toEqual([]);
  });
  it("falls back to the default account and judges each provider alone", () => {
    addAccount({ id: "cx", provider: "codex", dir: dirOf("cx") }, { home });
    addAccount({ id: "c", provider: "claude", dir: dirOf("c") }, { home });
    const lines = warn({ CODEX_HOME: dirOf("cx"), CLAUDE_CONFIG_DIR: dirOf("z") });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^claude session runs on .*z; this project uses account "c"/);
  });
});

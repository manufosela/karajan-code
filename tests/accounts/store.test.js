import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountEnv, accountFor, addAccount, assignAccounts, readAccounts, removeAccount, setDefault, setPace } from "../../src/accounts/store.js";

let home;
let login;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-accounts-"));
  login = fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(login, { recursive: true, force: true });
});

describe("accounts store (HU-4587, ADR 0064)", () => {
  it("is empty and changes nothing while no account is added", () => {
    expect(readAccounts({ home })).toEqual({ accounts: [], default: {}, projects: {} });
    expect(accountEnv("claude", { home })).toEqual({});
    expect(fs.existsSync(path.join(home, "accounts.json"))).toBe(false);
  });

  it("makes the first account of a provider its default and keeps the file private", () => {
    addAccount({ id: "work", provider: "claude", dir: login }, { home });
    expect(readAccounts({ home }).default).toEqual({ claude: "work" });
    expect(accountEnv("claude", { home })).toEqual({ CLAUDE_CONFIG_DIR: login });
    expect(accountEnv("codex", { home })).toEqual({});
    expect(fs.statSync(path.join(home, "accounts.json")).mode & 0o777).toBe(0o600);
  });

  it("gives codex its CODEX_HOME and a second account only when chosen as default", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-"));
    addAccount({ id: "a", provider: "codex", dir: login }, { home });
    addAccount({ id: "b", provider: "codex", dir: other }, { home });
    expect(accountEnv("codex", { home })).toEqual({ CODEX_HOME: login });
    setDefault("b", { home });
    expect(accountEnv("codex", { home })).toEqual({ CODEX_HOME: other });
    fs.rmSync(other, { recursive: true, force: true });
  });

  it("drops the default with the account removed", () => {
    addAccount({ id: "work", provider: "claude", dir: login }, { home });
    removeAccount("work", { home });
    expect(readAccounts({ home })).toEqual({ accounts: [], default: {}, projects: {} });
    expect(() => removeAccount("work", { home })).toThrow(/no account "work"/);
  });

  it("refuses a bad id, an unknown provider, a missing or relative dir and a repeated id", () => {
    expect(() => addAccount({ id: "--x", provider: "claude", dir: login }, { home })).toThrow(/id/);
    expect(() => addAccount({ id: "x", provider: "gemini", dir: login }, { home })).toThrow(/provider/);
    expect(() => addAccount({ id: "x", provider: "claude", dir: "rel/dir" }, { home })).toThrow(/absolute/);
    expect(() => addAccount({ id: "x", provider: "claude", dir: path.join(login, "nope") }, { home })).toThrow(/not a directory/);
    addAccount({ id: "x", provider: "claude", dir: login }, { home });
    expect(() => addAccount({ id: "x", provider: "codex", dir: login }, { home })).toThrow(/already/);
    expect(() => setDefault("y", { home })).toThrow(/no account "y"/);
  });

  describe("per project order (HU-4588)", () => {
    const project = "/work/repo";
    const second = () => fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-"));
    let other;
    beforeEach(() => {
      other = second();
      addAccount({ id: "a", provider: "claude", dir: login }, { home });
      addAccount({ id: "b", provider: "claude", dir: other }, { home });
      addAccount({ id: "c", provider: "codex", dir: login }, { home });
    });
    afterEach(() => fs.rmSync(other, { recursive: true, force: true }));

    it("takes the first account of the project's order, the default elsewhere", () => {
      assignAccounts(project, "claude", ["b", "a"], { home });
      expect(accountEnv("claude", { home, projectKey: project })).toEqual({ CLAUDE_CONFIG_DIR: other });
      expect(accountEnv("claude", { home, projectKey: "/work/else" })).toEqual({ CLAUDE_CONFIG_DIR: login });
      expect(accountEnv("codex", { home, projectKey: project })).toEqual({ CODEX_HOME: login });
      expect(readAccounts({ home }).projects).toEqual({ [project]: { claude: ["b", "a"] } });
    });

    it("refuses an unknown id or one of another provider and writes nothing", () => {
      expect(() => assignAccounts(project, "claude", ["zz"], { home })).toThrow(/no account "zz"/);
      expect(() => assignAccounts(project, "claude", ["c"], { home })).toThrow(/not a claude account/);
      expect(() => assignAccounts(project, "claude", [], { home })).toThrow(/at least one/);
      expect(readAccounts({ home }).projects).toEqual({});
    });

    it("removes a removed account from every order and fails loudly on a dangling id", () => {
      assignAccounts(project, "claude", ["b", "a"], { home });
      removeAccount("b", { home });
      expect(readAccounts({ home }).projects[project].claude).toEqual(["a"]);
      const file = path.join(home, "accounts.json");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      data.projects[project].claude = ["ghost"];
      fs.writeFileSync(file, JSON.stringify(data));
      expect(() => accountEnv("claude", { home, projectKey: project })).toThrow(/repo.*ghost/);
    });
  });

  it("stores a validated pace and resolves it with the account (HU-4591)", () => {
    addAccount({ id: "work", provider: "claude", dir: login }, { home });
    expect(accountFor("claude", { home }).pace).toBeUndefined();
    setPace("work", { gapSeconds: 2, maxConcurrent: 3, limitWaitSeconds: 60 }, { home });
    expect(accountFor("claude", { home })).toEqual({ id: "work", env: { CLAUDE_CONFIG_DIR: login }, pace: { gapSeconds: 2, maxConcurrent: 3, limitWaitSeconds: 60 } });
    expect(() => setPace("work", { gapSeconds: -1 }, { home })).toThrow(/gapSeconds/);
    expect(() => setPace("work", { maxConcurrent: 0 }, { home })).toThrow(/maxConcurrent/);
    expect(() => setPace("work", { maxConcurrent: 1.5 }, { home })).toThrow(/maxConcurrent/);
    expect(() => setPace("nope", {}, { home })).toThrow(/no account/);
  });
  it("fails loudly on a broken file instead of running on the wrong login", () => {
    fs.writeFileSync(path.join(home, "accounts.json"), "{not json");
    expect(() => accountEnv("claude", { home })).toThrow(/accounts\.json/);
  });
});

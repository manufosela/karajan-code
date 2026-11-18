import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountCommand } from "../../src/commands/account.js";
import { readAccounts } from "../../src/accounts/store.js";

let home;
let login;
let lines;
const run = (action, args) => accountCommand(action, args, { home, print: (line) => lines.push(line) });
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-account-cmd-"));
  login = fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-"));
  lines = [];
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(login, { recursive: true, force: true });
});

describe("kj account (HU-4599, ADR 0064)", () => {
  it("says the agents keep their inherited login while there is no account", () => {
    run("list");
    expect(lines).toEqual(["no accounts: kj launches each agent with the login it inherits"]);
  });

  it("adds an account, resolving a relative dir, and lists it as the provider's default", () => {
    const relative = path.relative(process.cwd(), login);
    run("add", { id: "work", provider: "claude", dir: relative });
    expect(readAccounts({ home }).accounts).toEqual([{ id: "work", provider: "claude", dir: login }]);
    expect(lines.at(-1)).toBe("✓ account work added for claude (its default)");
    lines = [];
    run("list");
    expect(lines).toEqual([`* work  claude  ${login}`]);
  });

  it("moves the default and removes an account", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-"));
    run("add", { id: "a", provider: "codex", dir: login });
    run("add", { id: "b", provider: "codex", dir: other });
    expect(lines.at(-1)).toBe("✓ account b added for codex");
    run("default", { id: "b" });
    expect(lines.at(-1)).toBe("✓ b is now the default codex account");
    run("remove", { id: "a" });
    expect(lines.at(-1)).toBe("✓ account a removed");
    lines = [];
    run("list");
    expect(lines).toEqual([`* b  codex  ${other}`]);
    fs.rmSync(other, { recursive: true, force: true });
  });

  describe("use, the project's order (HU-4588)", () => {
    let project;
    let other;
    const inProject = (action, args) => accountCommand(action, args, { home, cwd: project, print: (line) => lines.push(line) });
    beforeEach(() => {
      project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-project-")));
      other = fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-"));
      run("add", { id: "a", provider: "claude", dir: login });
      run("add", { id: "b", provider: "claude", dir: other });
      run("add", { id: "c", provider: "codex", dir: login });
      lines = [];
    });
    afterEach(() => {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(other, { recursive: true, force: true });
    });

    it("orders each provider's accounts for the project and lists the order", () => {
      inProject("use", { ids: ["b", "c", "a"] });
      expect(readAccounts({ home }).projects[project]).toEqual({ claude: ["b", "a"], codex: ["c"] });
      expect(lines).toEqual([`✓ ${path.basename(project)} uses claude: b, a`, `✓ ${path.basename(project)} uses codex: c`]);
      lines = [];
      inProject("list");
      expect(lines.slice(-2)).toEqual([`${path.basename(project)}: claude b, a`, `${path.basename(project)}: codex c`]);
    });

    it("clears the project's order back to the defaults", () => {
      inProject("use", { ids: ["b"] });
      inProject("use", { clear: true });
      expect(readAccounts({ home }).projects[project]).toBeUndefined();
      expect(lines.at(-1)).toBe(`✓ ${path.basename(project)} back to the default accounts`);
    });

    it("refuses an unknown id or no id, and writes nothing", () => {
      expect(() => inProject("use", { ids: ["a", "zz"] })).toThrow(/no account "zz"/);
      expect(() => inProject("use", { ids: [] })).toThrow(/at least one/);
      expect(readAccounts({ home }).projects).toEqual({});
    });
  });

  describe("pace (HU-4608)", () => {
    beforeEach(() => {
      run("add", { id: "work", provider: "claude", dir: login });
      lines = [];
    });
    const pace = () => readAccounts({ home }).accounts[0].pace;

    it("says an account without a pace runs its calls as they come", () => {
      run("pace", { id: "work" });
      expect(lines).toEqual(["work has no pace: its calls run as they come"]);
    });

    it("sets the pace from the flags and keeps the fields not given", () => {
      run("pace", { id: "work", gap: "30", max: "1" });
      run("pace", { id: "work", limitWait: "600" });
      expect(pace()).toEqual({ gapSeconds: 30, maxConcurrent: 1, limitWaitSeconds: 600 });
      expect(lines.at(-1)).toBe("✓ work: 30s between calls, at most 1 at once, 600s after a limit");
      lines = [];
      run("pace", { id: "work" });
      expect(lines).toEqual(["work: 30s between calls, at most 1 at once, 600s after a limit"]);
    });

    it("refuses a value that is not a valid number and writes nothing", () => {
      expect(() => run("pace", { id: "work", max: "0" })).toThrow(/maxConcurrent/);
      expect(() => run("pace", { id: "work", gap: "soon" })).toThrow(/gapSeconds/);
      expect(pace()).toBeUndefined();
    });
  });

  describe("check (HU-4595)", () => {
    const names = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    afterEach(() => {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n];
      }
    });
    it("says it cannot tell when no login variable is set", () => {
      for (const n of names) delete process.env[n];
      run("check");
      expect(lines).toEqual(["cannot tell which login this session uses"]);
    });
    it("says ok on a project account and warns on another", () => {
      run("add", { id: "work", provider: "claude", dir: login });
      lines = [];
      delete process.env.CODEX_HOME;
      process.env.CLAUDE_CONFIG_DIR = login;
      run("check");
      expect(lines).toEqual(["ok"]);
      lines = [];
      process.env.CLAUDE_CONFIG_DIR = os.tmpdir();
      run("check");
      expect(lines[0]).toMatch(/this project uses account "work"/);
    });
  });
  it("fails on an unknown id or action", () => {
    expect(() => run("remove", { id: "nope" })).toThrow(/no account "nope"/);
    expect(() => run("rename", {})).toThrow(/unknown action/);
  });
});

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

  it("fails on an unknown id or action", () => {
    expect(() => run("remove", { id: "nope" })).toThrow(/no account "nope"/);
    expect(() => run("rename", {})).toThrow(/unknown action/);
  });
});

// HU-3097 (step 13 P4): atril install plugin:<name> asks before installing, and says what it does not install yet.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeConfig } from "../src/config.js";
import { installConfirm, notInstalledLines, updateConfirm } from "../src/plugin-install-cli.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "atril.js");
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-plugin-cli-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel, content) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), typeof content === "string" ? content : JSON.stringify(content));
};
const market = (files = {}) => {
  put("mkt/.claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "kit", source: "./kit" }] });
  put("mkt/kit/.claude-plugin/plugin.json", { name: "kit", version: "1.0.0" });
  put("mkt/kit/commands/ship.md", "---\ndescription: Ship\n---\nShip it\n");
  for (const [rel, content] of Object.entries(files)) put(`mkt/kit/${rel}`, content);
  writeConfig({ catalogs: ["mkt"] }, { projectDir: dir, root: "store", userRoot: join(dir, "nouser") });
};
const atril = (...args) => atrilOf("kit", ...args);
const atrilOf = (name, ...args) => spawnSync(process.execPath, [BIN, "install", `plugin:${name}`, "--root", "store", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: dir } });
const inv = { name: "kit", version: "1.0.0", format: "claude", hooks: [], mcpServers: [], bin: [], npm: { packages: [] }, variables: [] };
const member = (name = "kit") => ({ name, status: "fetched", inventory: { ...inv, name } });

describe("installConfirm", () => {
  const out = () => { const lines = []; return { lines, err: (text) => lines.push(text) }; };
  it.each([["y", true], ["yes", true], ["n", false], ["", false]])("asks [y/N] on a terminal: %j", async (answer, expected) => {
    const { lines, err } = out();
    const ask = vi.fn(async () => answer);
    expect(await installConfirm({ yes: false, tty: true, ask, err }).confirm([member()])).toBe(expected);
    expect(lines.join("")).toContain("plugin kit");
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("[y/N]"));
  });
  it("--yes skips the question", async () => {
    const ask = vi.fn();
    expect(await installConfirm({ yes: true, tty: false, ask, err: () => {} }).confirm([member()])).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
  it("a set prints one header, every inventory in order and asks once", async () => {
    const { lines, err } = out();
    const ask = vi.fn(async () => "y");
    expect(await installConfirm({ yes: false, tty: true, ask, err }).confirm([member("a"), member("b"), member("app")])).toBe(true);
    const text = lines.join("");
    expect(text).toContain("3 plugins will be installed: a, b, app");
    expect(text.indexOf("plugin a ")).toBeLessThan(text.indexOf("plugin b "));
    expect(text.indexOf("plugin b ")).toBeLessThan(text.indexOf("plugin app "));
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it("a single plugin prints no header", async () => {
    const { lines, err } = out();
    await installConfirm({ yes: true, tty: false, ask: vi.fn(), err }).confirm([member()]);
    expect(lines.join("")).not.toContain("will be installed");
  });
  it("says what it will create in .rulesync/ before the question, and only when it will", async () => {
    const { lines, err } = out();
    const ask = vi.fn(async () => "y");
    await installConfirm({ yes: false, tty: true, ask, err }).confirm([member()], { creates: ["hooks.json", "mcp.json"] });
    const text = lines.join("");
    expect(text).toContain("no .rulesync/");
    expect(text).toContain("hooks.json, mcp.json and the ledger .owners.json");
    expect(text).toContain("no rulesync init example files");
    const quiet = out();
    await installConfirm({ yes: true, tty: false, ask, err: quiet.err }).confirm([member()], {});
    expect(quiet.lines.join("")).not.toContain("no .rulesync/");
  });
  it("a dry run says what it would create and writes nothing", async () => {
    const { lines, err } = out();
    const gate = installConfirm({ yes: false, tty: false, ask: vi.fn(), err });
    expect(await gate.confirm([member()], { creates: ["mcp.json"] })).toBe(false);
    expect(lines.join("")).toContain("mcp.json and the ledger");
    expect(lines.join("")).toContain("dry run");
  });
  it("no terminal and no --yes is a dry run", async () => {
    const { lines, err } = out();
    const gate = installConfirm({ yes: false, tty: false, ask: vi.fn(), err });
    expect(await gate.confirm([member()])).toBe(false);
    expect(gate.dryRun()).toBe(true);
    expect(lines.join("")).toContain("dry run");
  });
});

describe("updateConfirm", () => {
  const info = { source: { repo: "o/r" }, commit: "b".repeat(40), changed: false };
  const out = () => { const lines = []; return { lines, err: (text) => lines.push(text) }; };
  it("lists the new inventory and asks [y/N]", async () => {
    const { lines, err } = out();
    const ask = vi.fn(async () => "y");
    expect(await updateConfirm({ yes: false, tty: true, ask, err }).confirm(inv, info)).toBe(true);
    expect(lines.join("")).toContain("plugin kit");
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("[y/N]"));
  });
  it("warns before the second question, when the inventory changed", async () => {
    const { lines, err } = out();
    const ask = vi.fn(async () => "n");
    expect(await updateConfirm({ yes: false, tty: true, ask, err }).confirm(inv, { ...info, changed: true, again: true })).toBe(false);
    expect(lines.join("")).toContain("differ from the installed one");
    expect(lines.join("")).not.toContain("plugin kit");
  });
  it("--yes asks nothing and no terminal is a dry run", async () => {
    const ask = vi.fn();
    expect(await updateConfirm({ yes: true, tty: false, ask, err: () => {} }).confirm(inv, info)).toBe(true);
    const gate = updateConfirm({ yes: false, tty: false, ask, err: () => {} });
    expect(await gate.confirm(inv, info)).toBe(false);
    expect(gate.dryRun()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("notInstalledLines", () => {
  it("prefixes each line with the plugin name when asked", () => {
    expect(notInstalledLines({ notInstalled: { hooks: [{}], mcpServers: [], bin: [] } }, "dep")).toEqual(["atril: dep: not installed yet: 1 hook(s)"]);
  });
  it("says the commands point to the store copy the team must commit, never that atril sync restores it", () => {
    const base = { notInstalled: { hooks: [], mcpServers: [], bin: [] } };
    const lines = notInstalledLines({ ...base, rulesync: { status: "merged", rewritten: true } });
    expect(lines.filter((line) => line.includes("commit"))).toHaveLength(1);
    expect(lines.join("\n")).not.toMatch(/atril sync/);
    expect(notInstalledLines({ ...base, rulesync: { status: "merged" } }).join("\n")).not.toMatch(/commit/);
  });
  it("names each skipped hook or MCP server with the reason", () => {
    const base = { plugin: "kit", notInstalled: { hooks: [], mcpServers: [], bin: [] } };
    const skipped = [{ kind: "hook", name: "Stop: VAR=1 ./x.sh", reason: "mixes shell syntax" }];
    const text = notInstalledLines({ ...base, rulesync: { status: "merged", skipped } }).join("\n");
    expect(text).toContain("left out hook \"Stop: VAR=1 ./x.sh\": mixes shell syntax");
    expect(text).toContain("one command per hook");
  });
  it("names, one line per entry, each ./ path left to the project because the plugin does not ship it", () => {
    const base = { plugin: "kit", notInstalled: { hooks: [], mcpServers: [], bin: [] } };
    const kept = [{ kind: "hook", name: "Stop: ./missing.sh", path: "./missing.sh" }, { kind: "mcp", name: "db", path: "./nope.js" }];
    const lines = notInstalledLines({ ...base, rulesync: { status: "merged", kept } }).filter((line) => line.includes("project"));
    expect(lines).toEqual([
      "atril: left hook \"Stop: ./missing.sh\" with ./missing.sh as it is: the plugin does not ship it, so it is the project's",
      "atril: left mcp \"db\" with ./nope.js as it is: the plugin does not ship it, so it is the project's",
    ]);
    expect(notInstalledLines({ ...base, rulesync: { status: "merged" } }).join("\n")).not.toMatch(/the project's/);
  });
  it("says which environment variable a merged MCP server or hook needs, naming the plugin, once per variable", () => {
    const base = { plugin: "kit", notInstalled: { hooks: [], mcpServers: [], bin: [] } };
    const lines = notInstalledLines({ ...base, rulesync: { status: "merged", needs: ["TOKEN", "KEY2"] } });
    expect(lines.filter((line) => /needs \$\{(TOKEN|KEY2)\}/.test(line) && line.includes("kit"))).toHaveLength(2);
    expect(notInstalledLines({ ...base, rulesync: { status: "merged" } }).join("\n")).not.toMatch(/environment/);
  });
  it("says .rulesync/ was created, only when the install created it", () => {
    const base = { notInstalled: { hooks: [], mcpServers: [], bin: [] } };
    expect(notInstalledLines({ ...base, rulesync: { status: "merged", created: true } })).toContain("atril: created .rulesync/ (it did not exist)");
    expect(notInstalledLines({ ...base, rulesync: { status: "merged" } }).join("\n")).not.toMatch(/created/);
  });
  it("lists hooks, MCP servers, bin and unsupported npm", () => {
    const text = notInstalledLines({ notInstalled: { hooks: [{}], mcpServers: [{ name: "db" }], bin: ["x"] }, npm: { status: "unsupported", reason: "no lockfile" } }).join("\n");
    expect(text).toMatch(/1 hook/);
    expect(text).toMatch(/db/);
    expect(text).toMatch(/bin/);
    expect(text).toMatch(/no lockfile/);
  });
});

describe("atril update plugin:<name>", () => {
  const update = (...args) => spawnSync(process.execPath, [BIN, "update", ...args, "--root", "store", "--json"], { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: dir } });
  const installed = () => { market(); atril("--yes"); put("mkt/kit/.claude-plugin/plugin.json", { name: "kit", version: "2.0.0" }); };
  it("without a terminal and without --yes it is a dry run: the plugin is reported, nothing written", () => {
    installed();
    const res = update("plugin:kit");
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/plugin kit .*\n[\s\S]*dry run/);
    expect(JSON.parse(res.stdout).plugins).toMatchObject([{ plugin: "kit", status: "declined", dryRun: true }]);
    expect(JSON.parse(readFileSync(join(dir, "store", "atril.lock.json"), "utf8")).plugins.kit.version).toBe("1.0.0");
  });
  it("--yes updates the plugin and the lock", () => {
    installed();
    const res = update("plugin:kit", "--yes");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).plugins).toMatchObject([{ plugin: "kit", status: "updated", version: "2.0.0" }]);
    expect(JSON.parse(readFileSync(join(dir, "store", "atril.lock.json"), "utf8")).plugins.kit.version).toBe("2.0.0");
  });
  it("plain atril update also looks at the installed plugins, and a plugin that is not installed fails loudly", () => {
    installed();
    expect(JSON.parse(update().stdout).plugins).toMatchObject([{ plugin: "kit", status: "declined" }]);
    const res = update("plugin:ghost");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('plugin "ghost" is not installed');
  });
});

describe("atril install plugin:<name>", () => {
  it("--yes installs and --json carries notInstalled", () => {
    market({ "hooks/hooks.json": { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo" }] }] } } });
    // No rulesync on this machine: an npx that fails first in PATH.
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "npx"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const res = spawnSync(process.execPath, [BIN, "install", "plugin:kit", "--root", "store", "--yes", "--json"], { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: dir, PATH: `${join(dir, "bin")}${delimiter}${process.env.PATH}` } });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ plugin: "kit", status: "installed", rulesync: { status: "absent" }, notInstalled: { hooks: [expect.anything()] } });
    expect(res.stderr).toMatch(/rulesync is not installed/);
    expect(existsSync(join(dir, "store", "commands", "kit__ship.md"))).toBe(true);
  });
  it.each(["--yes", "--json"])("%s on a plain install fails loudly", (flag) => {
    const res = spawnSync(process.execPath, [BIN, "install", "skill:x", flag, "--root", "store"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`${flag} only applies to install plugin:<name>`);
  });
  it("without a terminal and without --yes it is a dry run: nothing written", () => {
    market();
    const res = atril("--json");
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/dry run/);
    expect(JSON.parse(res.stdout)).toMatchObject({ status: "declined" });
    expect(existsSync(join(dir, "store", "commands"))).toBe(false);
  });
  describe("a plugin with a dependency", () => {
    const set = () => {
      market();
      put("mkt/.claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "kit", source: "./kit" }, { name: "app", source: "./app" }] });
      put("mkt/app/.claude-plugin/plugin.json", { name: "app", version: "2.0.0", dependencies: ["kit"] });
      put("mkt/app/commands/run.md", "---\ndescription: Run\n---\nRun it\n");
    };
    it("asks once, lists the set in order and --json adds dependencies and skipped", () => {
      set();
      const res = atrilOf("app", "--yes", "--json");
      expect(res.status).toBe(0);
      expect(res.stderr).toContain("2 plugins will be installed: kit (split), app (split)");
      expect(res.stderr.indexOf("plugin kit ")).toBeLessThan(res.stderr.indexOf("plugin app "));
      expect(JSON.parse(res.stdout)).toMatchObject({ plugin: "app", status: "installed", dependencies: [{ plugin: "kit" }], skipped: [] });
      expect(existsSync(join(dir, "store", "commands", "kit__ship.md"))).toBe(true);
    });
    it("reports an already installed dependency as skipped", () => {
      set();
      atril("--yes");
      const res = atrilOf("app", "--yes", "--json");
      expect(res.stderr).toContain("atril: already installed or chosen skip/native, left out: kit");
      expect(JSON.parse(res.stdout)).toMatchObject({ dependencies: [], skipped: ["kit"] });
    });
    it("a dry run writes nothing", () => {
      set();
      const res = atrilOf("app");
      expect(res.stderr).toMatch(/dry run/);
      expect(existsSync(join(dir, "store", "commands"))).toBe(false);
    });
  });
});

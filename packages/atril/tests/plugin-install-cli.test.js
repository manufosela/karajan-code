// HU-3097 (step 13 P4): atril install plugin:<name> asks before installing, and says what it does not install yet.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeConfig } from "../src/config.js";
import { installConfirm, notInstalledLines } from "../src/plugin-install-cli.js";

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
const atril = (...args) => spawnSync(process.execPath, [BIN, "install", "plugin:kit", "--root", "store", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: dir } });
const inventory = { name: "kit", version: "1.0.0", format: "claude", hooks: [], mcpServers: [], bin: [], npm: { packages: [] }, variables: [] };

describe("installConfirm", () => {
  const out = () => { const lines = []; return { lines, err: (text) => lines.push(text) }; };
  it.each([["y", true], ["yes", true], ["n", false], ["", false]])("asks [y/N] on a terminal: %j", async (answer, expected) => {
    const { lines, err } = out();
    const ask = vi.fn(async () => answer);
    expect(await installConfirm({ yes: false, tty: true, ask, err }).confirm(inventory, {})).toBe(expected);
    expect(lines.join("")).toContain("plugin kit");
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("[y/N]"));
  });
  it("--yes skips the question", async () => {
    const ask = vi.fn();
    expect(await installConfirm({ yes: true, tty: false, ask, err: () => {} }).confirm(inventory, {})).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
  it("no terminal and no --yes is a dry run", async () => {
    const { lines, err } = out();
    const gate = installConfirm({ yes: false, tty: false, ask: vi.fn(), err });
    expect(await gate.confirm(inventory, {})).toBe(false);
    expect(gate.dryRun()).toBe(true);
    expect(lines.join("")).toContain("dry run");
  });
});

describe("notInstalledLines", () => {
  it("lists hooks, MCP servers, bin and unsupported npm", () => {
    const text = notInstalledLines({ notInstalled: { hooks: [{}], mcpServers: [{ name: "db" }], bin: ["x"] }, npm: { status: "unsupported", reason: "no lockfile" } }).join("\n");
    expect(text).toMatch(/1 hook/);
    expect(text).toMatch(/db/);
    expect(text).toMatch(/bin/);
    expect(text).toMatch(/no lockfile/);
  });
});

describe("atril install plugin:<name>", () => {
  it("--yes installs and --json carries notInstalled", () => {
    market({ "hooks/hooks.json": { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo" }] }] } } });
    const res = atril("--yes", "--json");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ plugin: "kit", status: "installed", notInstalled: { hooks: [expect.anything()] } });
    expect(res.stderr).toMatch(/not installed yet/);
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
});

// ADR 0021, plan step 13 P3b: installPlugin composes find, fetch, inventory, confirm, npm and the Markdown install.
// Git and npm are fakes: no network.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeConfig } from "../src/config.js";
import { SAFE } from "../src/fetch.js";
import { readLock } from "../src/lock.js";
import { installPlugin } from "../src/plugin-install.js";

const C1 = "a".repeat(40);
let dir, calls, runs, tree, confirm;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-plugin-install-"));
  calls = [];
  runs = 0;
  tree = {};
  confirm = vi.fn(() => true);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (base, rel, content) => {
  mkdirSync(dirname(join(base, rel)), { recursive: true });
  writeFileSync(join(base, rel), typeof content === "string" ? content : JSON.stringify(content));
};
const plant = (base, extra = {}) => {
  put(base, ".claude-plugin/plugin.json", { name: "kit", version: "1.0.0", ...extra.manifest });
  put(base, "skills/tdd/SKILL.md", "---\nname: tdd\ndescription: Test first\n---\nbody\n");
  put(base, "commands/ship.md", "---\ndescription: Ship\n---\nShip it\n");
  for (const [rel, content] of Object.entries(extra.files ?? {})) put(base, rel, content);
};
const git = (args, cwd) => {
  const [verb, ...rest] = args.slice(SAFE.length);
  calls.push(verb);
  if (verb === "fetch") { mkdirSync(join(cwd, ".git"), { recursive: true }); plant(cwd, tree); }
  return verb === "rev-parse" ? `${C1}\n` : "";
};
const run = (_cmd, _args, cwd) => { runs++; mkdirSync(join(cwd, "node_modules")); };
const NPM = { "package.json": { name: "kit", dependencies: { a: "1.0.0" } }, "package-lock.json": { lockfileVersion: 3, packages: {} } };
const market = (source) => {
  put(dir, "mkt/.claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "kit", source }] });
  writeConfig({ catalogs: ["mkt"] }, { projectDir: dir, root: "store", userRoot: join(dir, "nouser") });
};
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "nouser") });
const install = (opts = o()) => installPlugin("kit", opts, { confirm, git, run });
const lock = () => readLock(o());
const GH = { source: "github", repo: "o/r", sha: C1 };

describe("installPlugin", () => {
  it("installs a Markdown-only plugin and records it", async () => {
    market(GH);
    const result = await install();
    expect(result).toMatchObject({ plugin: "kit", version: "1.0.0", commit: C1, catalog: "mkt", status: "installed", fetched: "fetched", notInstalled: { hooks: [], mcpServers: [], bin: [] } });
    expect(lock().plugins.kit).toEqual({ catalog: "mkt", source: "o/r", commit: C1, version: "1.0.0", entries: ["command:kit__ship", "skill:kit__tdd"] });
    expect(Object.values(lock().artifacts).every((a) => a.origin === "plugin")).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toMatchObject({ name: "kit" });
    expect(confirm.mock.calls[0][1]).toMatchObject({ commit: C1, status: "fetched" });
  });

  it.each([() => false, async () => false])("declines without writing the store or the lock, and keeps the cache", async (answer) => {
    market(GH);
    tree = { files: NPM };
    confirm = vi.fn(answer);
    expect((await install()).status).toBe("declined");
    expect(existsSync(join(dir, "store", "skills"))).toBe(false);
    expect(existsSync(join(dir, "store", "commands"))).toBe(false);
    expect(lock().plugins).toBeUndefined();
    expect(runs).toBe(0);
    expect(existsSync(join(dir, "store", "plugins", "kit", "1.0.0"))).toBe(true);
  });

  it("rolls the store and lock back on a failure and keeps the cache", async () => {
    market(GH);
    tree = { files: NPM };
    put(dir, "store/commands/kit__ship.md", "---\ndescription: Mine\n---\nlocal\n");
    await expect(install()).rejects.toThrow("already exists");
    expect(existsSync(join(dir, "store", "skills", "kit__tdd"))).toBe(false);
    expect(Object.keys(lock().artifacts ?? {})).not.toContain("skill:kit__tdd");
    expect(lock().plugins?.kit).toBeUndefined();
    expect(readFileSync(join(dir, "store", "commands", "kit__ship.md"), "utf8")).toContain("local");
    expect(existsSync(join(dir, "store", "plugins", "kit", "1.0.0", "node_modules"))).toBe(true);
  });

  it("reports hooks (file and inline) and MCP servers as not installed", async () => {
    market(GH);
    const hook = { type: "command", command: "x" };
    tree = { manifest: { hooks: { Stop: [{ matcher: "", hooks: [hook] }] } }, files: { "hooks/hooks.json": { hooks: { Start: [{ matcher: "", hooks: [hook] }] } }, ".mcp.json": { mcpServers: { db: { command: "npx" } } } } };
    const result = await install();
    expect(result.entries.length).toBe(2);
    expect(result.notInstalled.hooks).toHaveLength(2);
    expect(result.notInstalled.mcpServers[0].name).toBe("db");
  });

  it("a reinstall reuses the cache and its node_modules, asks again, and leaves the lock byte-identical", async () => {
    market(GH);
    tree = { files: NPM };
    await install();
    const before = readFileSync(join(dir, "store", "atril.lock.json"), "utf8");
    calls.length = 0;
    const again = await install();
    expect(again).toMatchObject({ fetched: "cached", npm: { status: "present" } });
    expect(again.entries.map((e) => e.status)).toEqual(["unchanged", "unchanged"]);
    expect([runs, calls.includes("fetch"), confirm.mock.calls.length]).toEqual([1, false, 2]);
    expect(readFileSync(join(dir, "store", "atril.lock.json"), "utf8")).toBe(before);
  });

  it("never writes a path source or the tmp dir into the lock", async () => {
    plant(join(dir, "mkt", "plugins", "kit"));
    market("./plugins/kit");
    await install();
    expect(lock().plugins.kit).not.toHaveProperty("source");
    expect(lock().plugins.kit).not.toHaveProperty("commit");
    expect(JSON.stringify(lock())).not.toContain(dir);
  });

  it("throws before any git call without a confirm function", async () => {
    market(GH);
    await expect(installPlugin("kit", o(), { git })).rejects.toThrow("confirm");
    expect(calls).toEqual([]);
  });

  it("installs the Markdown and reports npm unsupported when there is no lockfile", async () => {
    market(GH);
    tree = { files: { "package.json": { name: "kit", dependencies: { a: "1" } } } };
    const result = await install();
    expect(result.status).toBe("installed");
    expect(result.npm.status).toBe("unsupported");
    expect(result.npm.reason).toBeTruthy();
    expect(runs).toBe(0);
  });
});

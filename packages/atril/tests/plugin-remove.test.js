// HU-3098 (step 13 P5): removePlugin deletes what the lock lists for a plugin, all or nothing; --purge also drops cache and data.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLock, writeLock } from "../src/lock.js";
import { removeDerived, writeDerived } from "../src/plugin-derived.js";
import { installPluginMarkdown } from "../src/plugin-markdown.js";
import { removePlugin } from "../src/plugin-remove.js";
import { install } from "../src/store.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "atril.js");
let dir;
const o = () => ({ projectDir: dir, root: "store" });
const put = (rel, content) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-plugin-remove-"));
  put("kit/.claude-plugin/plugin.json", JSON.stringify({ name: "kit", version: "1.0.0" }));
  put("kit/skills/tdd/SKILL.md", "---\nname: tdd\ndescription: Test first\n---\nbody\n");
  put("kit/commands/ship.md", "---\ndescription: Ship\n---\nShip it\n");
  installPluginMarkdown(join(dir, "kit"), o(), { from: { catalog: "mkt" } });
  put("own.md", "---\nname: own\nkind: command\ndescription: Mine\n---\nmine\n");
  install(join(dir, "own.md"), o());
  put("store/plugins/kit/state.json", "{}");
  put("store/plugins/kit/1.0.0/x", "x");
  put("store/plugins/.data/kit/y", "y");
  put("store/plugins/other/state.json", "{}");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const has = (rel) => existsSync(join(dir, "store", rel));

describe("removePlugin", () => {
  it("deletes the plugin's artifacts and lock entry, nothing else, and keeps cache and data", () => {
    expect(removePlugin("kit", o())).toEqual({ plugin: "kit", removed: ["command:kit__ship", "skill:kit__tdd"], purged: false });
    expect(has("skills/kit__tdd")).toBe(false);
    expect(has("commands/kit__ship.md")).toBe(false);
    expect(has("commands/own.md")).toBe(true);
    expect(Object.keys(readLock(o()).artifacts)).toEqual(["command:own"]);
    expect(readLock(o()).plugins).toBeUndefined();
    expect(has("plugins/kit/1.0.0/x")).toBe(true);
    expect(has("plugins/.data/kit/y")).toBe(true);
  });

  it("--purge also removes the cache and the data, and only this plugin's", () => {
    expect(removePlugin("kit", { ...o(), purge: true }).purged).toBe(true);
    expect(has("plugins/kit")).toBe(false);
    expect(has("plugins/.data/kit")).toBe(false);
    expect(has("plugins/other/state.json")).toBe(true);
  });

  it("an unknown plugin fails naming it, and touches nothing", () => {
    expect(() => removePlugin("nope", o())).toThrow(/"nope" is not installed/);
    expect(has("skills/kit__tdd")).toBe(true);
  });

  it("leaves nothing half-removed when the lock cannot be written", () => {
    chmodSync(join(dir, "store"), 0o555); // the artifact folders stay writable; the lock's temp file cannot be created
    try {
      expect(() => removePlugin("kit", { ...o(), purge: true })).toThrow();
    } finally {
      chmodSync(join(dir, "store"), 0o755);
    }
    expect(has("skills/kit__tdd/SKILL.md")).toBe(true);
    expect(has("commands/kit__ship.md")).toBe(true);
    expect(has("plugins/kit/1.0.0/x")).toBe(true);
    expect(has("plugins/.data/kit/y")).toBe(true);
    expect(readLock(o()).plugins.kit).toBeDefined();
  });

  it("a leftover that cannot be deleted after the lock is written is reported, not a failure", () => {
    put("store/skills/kit__tdd/locked/f", "f");
    chmodSync(join(dir, "store/skills/kit__tdd/locked"), 0o555);
    const result = removePlugin("kit", o());
    expect(result.leftBehind).toHaveLength(1);
    expect(readLock(o()).plugins).toBeUndefined();
    chmodSync(join(result.leftBehind[0], "locked"), 0o755);
  });

  it("refuses an artifact the lock gives to someone else, before touching anything", () => {
    const lock = readLock(o());
    lock.artifacts["command:kit__ship"] = { ...lock.artifacts["command:kit__ship"], origin: "local", plugin: undefined };
    writeLock(lock, o());
    expect(() => removePlugin("kit", o())).toThrow(/command:kit__ship is not owned by plugin "kit"/);
    expect(has("skills/kit__tdd")).toBe(true);
  });
});

describe("removePlugin with dependents (HU-3195)", () => {
  const dependOn = (...names) => {
    const lock = readLock(o());
    lock.plugins.app = { entries: [], dependencies: names };
    writeLock(lock, o());
  };
  it("refuses while an installed plugin depends on it, naming the dependents, and touches nothing", () => {
    dependOn("kit");
    expect(() => removePlugin("kit", o())).toThrow(/"kit" is required by: app/);
    expect(has("skills/kit__tdd")).toBe(true);
    expect(readLock(o()).plugins.kit).toBeDefined();
  });
  it("--force removes it anyway", () => {
    dependOn("kit");
    expect(removePlugin("kit", { ...o(), force: true }).removed).toContain("skill:kit__tdd");
    expect(readLock(o()).plugins.kit).toBeUndefined();
  });
  it("removing the dependent itself is not blocked by it", () => {
    dependOn("kit");
    expect(removePlugin("app", o()).plugin).toBe("app");
  });
  it("an old lock entry without dependencies still loads and removes", () => {
    expect(readLock(o()).plugins.kit.dependencies).toBeUndefined();
    expect(removePlugin("kit", o()).plugin).toBe("kit");
  });
  it("the CLI refuses with the dependents and --force passes through", () => {
    dependOn("kit");
    const cli = (...a) => spawnSync(process.execPath, [BIN, "remove", "plugin:kit", "--root", "store", ...a], { cwd: dir, encoding: "utf8" });
    const refused = cli();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("required by: app");
    expect(cli("--force").status).toBe(0);
  });
});

describe("removePlugin with a derived plugin (HU-3184, ADR 0042)", () => {
  const HOOKS = { hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } };
  const derive = (name = "kit") => {
    put("copy/hooks/hooks.json", JSON.stringify(HOOKS));
    writeDerived(name, "1.0.0", join(dir, "copy"), { root: join(dir, "store"), hooks: 1, mcpServers: 0 });
  };
  const listed = () => JSON.parse(readFileSync(join(dir, "store/plugins/.marketplace/.claude-plugin/marketplace.json"), "utf8")).plugins.map((p) => p.name);

  it("deletes the derived plugin and its marketplace entry, keeps the other entries, and lists the uninstall command", () => {
    derive();
    derive("other");
    const { derived } = removePlugin("kit", o());
    expect(has("plugins/kit/derived")).toBe(false);
    expect(has("plugins/other/derived")).toBe(true);
    expect(listed()).toEqual(["other"]);
    expect(derived.commands).toEqual([{ cli: "claude", command: "claude plugin uninstall 'kit@atril'" }]);
  });

  it("adds the marketplace removal when no derived plugin is left, and keeps the file as a reinstall does", () => {
    derive();
    const { derived } = removePlugin("kit", o());
    expect(listed()).toEqual([]);
    expect(derived.commands[0].command).toBe("claude plugin uninstall 'kit@atril' && claude plugin marketplace remove 'atril'");
  });

  it("a plugin without a derived plugin gets no extra field", () => {
    expect(removePlugin("kit", o())).not.toHaveProperty("derived");
  });

  it("the CLI prints the command in text and in --json, and runs no host CLI", () => {
    derive();
    const bin = join(dir, "bin");
    for (const cli of ["claude", "agy"]) {
      put(`bin/${cli}`, `#!/bin/sh\ntouch "${join(dir, "ran")}"\n`);
      chmodSync(join(bin, cli), 0o755);
    }
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const run = (...a) => spawnSync(process.execPath, [BIN, "remove", "plugin:kit", "--root", "store", ...a], { cwd: dir, encoding: "utf8", env });
    const text = run();
    expect(text.status).toBe(0);
    expect(text.stderr).toContain("claude: claude plugin uninstall 'kit@atril'");
    expect(existsSync(join(dir, "ran"))).toBe(false); // runs === 0
    derive();
    installPluginMarkdown(join(dir, "kit"), o(), { from: { catalog: "mkt" } });
    expect(JSON.parse(run("--json").stdout).derived.commands[0].cli).toBe("claude");
    expect(existsSync(join(dir, "ran"))).toBe(false);
  });

  it("rejects a name that would escape plugins/, deleting nothing", () => {
    expect(() => removeDerived("../store", join(dir, "store"))).toThrow(/invalid plugin name/);
    expect(has("plugins/kit")).toBe(true);
  });
});

describe("atril remove plugin:<name>", () => {
  const atril = (...args) => spawnSync(process.execPath, [BIN, "remove", "plugin:kit", "--root", "store", ...args], { cwd: dir, encoding: "utf8" });
  it("removes and prints the keys; --json and --purge work", () => {
    const res = atril("--purge", "--json");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ plugin: "kit", removed: ["command:kit__ship", "skill:kit__tdd"], purged: true });
    expect(has("plugins/kit")).toBe(false);
  });
  it("an unknown plugin exits 1 naming it", () => {
    atril();
    const res = atril();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('"kit" is not installed');
  });
  it("config --mode stores the choice and rejects an unknown one; remove of a skipped plugin has nothing to remove", () => {
    const config = (...args) => spawnSync(process.execPath, [BIN, "config", "plugin:ghost", "--root", "store", ...args], { cwd: dir, encoding: "utf8" });
    expect(config("--mode", "fast").stderr).toContain("pluginMode.ghost must be skip, split or native");
    expect(config("--mode", "skip").stdout).toBe("mode\tplugin:ghost\tskip\n");
    expect(JSON.parse(config("--mode", "skip", "--json").stdout)).toEqual({ plugin: "ghost", mode: "skip" });
    const gone = spawnSync(process.execPath, [BIN, "remove", "plugin:ghost", "--root", "store"], { cwd: dir, encoding: "utf8" });
    expect(gone.status).toBe(0);
    expect(gone.stdout).toContain("nothing to remove\tplugin:ghost\tchosen as skip");
  });
  it("--purge and --yes are refused where they do not apply", () => {
    const plain = spawnSync(process.execPath, [BIN, "remove", "skill:x", "--purge", "--root", "store"], { cwd: dir, encoding: "utf8" });
    expect(plain.stderr).toContain("--purge only applies to remove plugin:<name>");
    expect(atril("--yes").stderr).toContain("--yes only applies to install plugin:<name>");
  });
});

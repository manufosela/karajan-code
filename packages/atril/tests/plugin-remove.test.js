// HU-3098 (step 13 P5): removePlugin deletes what the lock lists for a plugin, all or nothing; --purge also drops cache and data.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLock, writeLock } from "../src/lock.js";
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
  it("--purge and --yes are refused where they do not apply", () => {
    const plain = spawnSync(process.execPath, [BIN, "remove", "skill:x", "--purge", "--root", "store"], { cwd: dir, encoding: "utf8" });
    expect(plain.stderr).toContain("--purge only applies to remove plugin:<name>");
    expect(atril("--yes").stderr).toContain("--yes only applies to install plugin:<name>");
  });
});

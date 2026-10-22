// HU-0022 (ADR 0021, decisions 10-12): <root>/atril.json holds the store's config.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, readConfig, writeConfig } from "../src/config.js";
const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-config-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store" });
const file = () => join(dir, "store", "atril.json");
const put = (value) => {
  mkdirSync(join(dir, "store"), { recursive: true });
  writeFileSync(file(), typeof value === "string" ? value : JSON.stringify(value));
};
describe("readConfig", () => {
  it("an absent atril.json is the documented default", () => {
    expect(readConfig(o())).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({ targets: [], expose: { skill: [], command: [], agent: [] }, catalogs: [], rulesync: { generate: false } });
  });
  it("fills what the file leaves out with the defaults", () => {
    put({ targets: ["claudecode"], expose: { command: ["review"] } });
    expect(readConfig(o())).toEqual({ ...DEFAULT_CONFIG, targets: ["claudecode"], expose: { skill: [], command: ["review"], agent: [] } });
  });
  it.each([
    [{ targets: "claudecode" }, /targets must be a list/],
    [{ targets: [""] }, /targets items must be non-empty strings/],
    [{ expose: { tool: [] } }, /expose\.tool: kind "tool" is not one of skill, command, agent/],
    [{ expose: { skill: ["Bad Name"] } }, /expose\.skill item "Bad Name" is not a slug/],
    [{ catalogs: [1] }, /catalogs items must be non-empty strings/],
    [{ rulesync: { generate: "yes" } }, /rulesync\.generate must be true or false/],
    [{ rulesync: { other: true } }, /rulesync\.other is not a known field/],
    [{ extra: 1 }, /extra is not a known field/],
    [[], /must be a JSON object/],
  ])("fails loudly naming the bad field: %j", (value, error) => {
    put(value);
    expect(() => readConfig(o())).toThrow(error);
    expect(() => readConfig(o())).toThrow(file());
  });
  it("fails loudly on invalid JSON", () => {
    put("{ nope");
    expect(() => readConfig(o())).toThrow(/invalid JSON/);
  });
});
describe("writeConfig", () => {
  it("writes sorted keys and a trailing newline, and round-trips stable", () => {
    const config = { rulesync: { generate: true }, targets: ["codexcli", "claudecode"], expose: { agent: ["x"], skill: [] } };
    writeConfig(config, o());
    const first = readFileSync(file(), "utf8");
    expect(first.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(first))).toEqual(["catalogs", "expose", "rulesync", "targets"]);
    expect(Object.keys(JSON.parse(first).expose)).toEqual(["agent", "command", "skill"]);
    writeConfig(readConfig(o()), o());
    expect(readFileSync(file(), "utf8")).toBe(first);
    expect(readdirSync(join(dir, "store"))).toEqual(["atril.json"]);
  });
  it("refuses an invalid config and leaves the file untouched", () => {
    put({ targets: ["a"] });
    expect(() => writeConfig({ targets: 1 }, o())).toThrow(/targets must be a list/);
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ targets: ["a"] });
  });
});
describe("atril config", () => {
  const run = (...args) => spawnSync(process.execPath, [BIN, "config", ...args], { cwd: dir, encoding: "utf8" });
  it("--json prints the effective config", () => {
    put({ targets: ["claudecode"] });
    const res = run("--root", "store", "--json");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ ...DEFAULT_CONFIG, targets: ["claudecode"] });
  });
  it("prints one line per field without --json, and fails loudly on a bad file", () => {
    expect(run("--root", "store").stdout).toMatch(/^targets\t\nexpose\.skill\t\n/);
    put({ targets: 3 });
    const res = run("--root", "store");
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/targets must be a list/);
  });
});

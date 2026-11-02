// HU-3200 (step 13, P8 B3): atril config plugin:<name> and the install-time report; a secret never reaches an output.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfig } from "../src/config.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "atril.js");
const SECRET = "s3cr3t-token-value";
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-config-cli-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel, content) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), typeof content === "string" ? content : JSON.stringify(content));
};
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args, "--root", "store"], {
  cwd: dir, encoding: "utf8", input, env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, "xdg") },
});
const userFile = join("xdg", "atril", "plugins", "kit.json");
const leaks = (res) => `${res.stdout}${res.stderr}`.includes(SECRET);
const install = () => {
  put("mkt/.claude-plugin/marketplace.json", { name: "m", plugins: [{ name: "kit", source: "./kit" }] });
  put("mkt/kit/.claude-plugin/plugin.json", { name: "kit", version: "1.0.0", userConfig: {
    api_token: { type: "string", title: "Token", sensitive: true }, region: { type: "string", title: "Region" } } });
  put("mkt/kit/commands/ship.md", "---\ndescription: Ship\n---\nShip it\n");
  writeConfig({ catalogs: ["mkt"] }, { projectDir: dir, root: "store", userRoot: join(dir, "nouser") });
  return run(["install", "plugin:kit", "--yes", "--json"]);
};

describe("atril install plugin:<name> without a terminal", () => {
  it("reports the declared keys with no value: stderr line and needsConfig", () => {
    const res = install();
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("atril: not configured: api_token, region; run atril config plugin:kit");
    expect(JSON.parse(res.stdout)).toMatchObject({ plugin: "kit", needsConfig: ["api_token", "region"] });
  });
});

describe("atril config plugin:<name>", () => {
  beforeEach(() => { install(); });
  it("lists each key as set or unset", () => {
    expect(run(["config", "plugin:kit"]).stdout).toMatch(/^api_token\tunset\nregion\tunset\n$/);
  });
  it("a sensitive --set reads stdin, never prints the value and stores it only in the per-user file", () => {
    const set = run(["config", "plugin:kit", "--set", "api_token"], `${SECRET}\n`);
    expect(set.status).toBe(0);
    const list = run(["config", "plugin:kit"]);
    const json = run(["config", "plugin:kit", "--json"]);
    expect(list.stdout).toContain("api_token\tset");
    expect(JSON.parse(json.stdout)).toContainEqual({ key: "api_token", sensitive: true, set: true });
    for (const res of [set, list, json]) expect(leaks(res)).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, userFile), "utf8"))).toEqual({ api_token: SECRET });
    expect(statSync(join(dir, userFile)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "store", "atril.json"), "utf8")).not.toContain(SECRET);
    expect(run(["install", "plugin:kit", "--yes", "--json"]).stderr).not.toContain("api_token");
  });
  it("a sensitive --set with a value in argv is refused without echoing it", () => {
    const res = run(["config", "plugin:kit", "--set", `api_token=${SECRET}`]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("stdin");
    expect(leaks(res)).toBe(false);
    expect(existsSync(join(dir, userFile))).toBe(false);
  });
  it("--set KEY=VALUE and --unset KEY on a plain key", () => {
    expect(run(["config", "plugin:kit", "--set", "region=eu"]).status).toBe(0);
    expect(run(["config", "plugin:kit"]).stdout).toContain("region\tset\teu");
    expect(run(["config", "plugin:kit", "--unset", "region"]).status).toBe(0);
    expect(run(["config", "plugin:kit"]).stdout).toContain("region\tunset");
  });
  it("--unset removes a sensitive value", () => {
    run(["config", "plugin:kit", "--set", "api_token"], SECRET);
    run(["config", "plugin:kit", "--unset", "api_token"]);
    expect(run(["config", "plugin:kit"]).stdout).toContain("api_token\tunset");
  });
  it("an undeclared key or an unknown plugin fails loudly", () => {
    expect(run(["config", "plugin:kit", "--set", "nope=1"]).stderr).toContain("nope");
    expect(run(["config", "plugin:ghost"]).status).toBe(1);
  });
});

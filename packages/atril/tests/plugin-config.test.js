// HU-3135 (step 13, P8 B1): a plugin's user_config values; a secret never leaves the per-user file.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "../src/config.js";
import { declaredPluginConfig, readPluginConfig, writePluginConfig } from "../src/plugin-config.js";

const SECRET = "s3cr3t-token-value";
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-pcfg-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const opts = (extra = {}) => ({ projectDir: dir, root: "store", env: { XDG_CONFIG_HOME: join(dir, "xdg") }, ...extra });
const userFile = () => join(dir, "xdg", "atril", "plugins", "kit.json");
const walk = (base) => readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
  const path = join(base, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

describe("declaredPluginConfig", () => {
  const plugin = (userConfig) => {
    mkdirSync(join(dir, "kit", ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, "kit", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "kit", userConfig }));
    return join(dir, "kit");
  };
  it("reads the keys the manifest declares: key, title, description, sensitive", () => {
    const at = plugin({ api_token: { type: "string", title: "Token", description: "API token", sensitive: true }, region: { type: "string", title: "Region", description: "Where" } });
    expect(declaredPluginConfig(at)).toEqual([
      { key: "api_token", title: "Token", description: "API token", sensitive: true },
      { key: "region", title: "Region", description: "Where", sensitive: false },
    ]);
  });
  it("declares nothing without userConfig", () => expect(declaredPluginConfig(plugin(undefined))).toEqual([]));
  it.each([[[]], [{ "1bad": {} }], [{ ok: "x" }]])("rejects a malformed userConfig %j", (bad) => {
    expect(() => declaredPluginConfig(plugin(bad))).toThrow(/userConfig/);
  });
});

describe("plugin config values", () => {
  it("round-trips a non-sensitive value through atril.json", () => {
    writePluginConfig("kit", "region", "eu", { ...opts(), sensitive: false });
    expect(JSON.parse(readFileSync(join(dir, "store", "atril.json"), "utf8")).pluginConfig).toEqual({ kit: { region: "eu" } });
    expect(readPluginConfig("kit", opts())).toEqual({ region: "eu" });
  });
  it("round-trips a sensitive value through the per-user file, mode 0600", () => {
    writePluginConfig("kit", "token", SECRET, { ...opts(), sensitive: true });
    expect(readPluginConfig("kit", opts())).toEqual({ token: SECRET });
    expect(statSync(userFile()).mode & 0o777).toBe(0o600);
  });
  it("keeps atril.json and the lock byte-identical when a sensitive value is set, and leaves the secret out of the store root", () => {
    writeConfig({ targets: ["claudecode"] }, opts());
    writeFileSync(join(dir, "store", "atril.lock.json"), `${JSON.stringify({ version: 1, artifacts: {} })}\n`);
    const before = walk(join(dir, "store")).map((path) => [path, readFileSync(path)]);
    writePluginConfig("kit", "token", SECRET, { ...opts(), sensitive: true });
    for (const [path, bytes] of before) expect(readFileSync(path).equals(bytes)).toBe(true);
    const files = walk(join(dir, "store"));
    expect(files).toHaveLength(before.length);
    for (const path of files) expect(readFileSync(path, "utf8")).not.toContain(SECRET);
  });
  it("lets the environment override both kinds", () => {
    writePluginConfig("kit", "region", "eu", { ...opts(), sensitive: false });
    writePluginConfig("kit", "token", SECRET, { ...opts(), sensitive: true });
    const env = { ...opts().env, ATRIL_PLUGIN_KIT_REGION: "us", ATRIL_PLUGIN_KIT_TOKEN: "from-ci" };
    expect(readPluginConfig("kit", opts({ env }))).toEqual({ region: "us", token: "from-ci" });
  });
  it("reads a declared key that only the environment sets; a dashed plugin is upper case with underscores", () => {
    const env = { ATRIL_PLUGIN_MY_KIT_api_key: "wrong", ATRIL_PLUGIN_MY_KIT_API_KEY: "v" };
    expect(readPluginConfig("my-kit", opts({ env, keys: ["api_key"] }))).toEqual({ api_key: "v" });
  });
});

describe("refusals", () => {
  it("refuses a sensitive value on win32", () => {
    expect(() => writePluginConfig("kit", "token", SECRET, { ...opts(), sensitive: true, platform: "win32" })).toThrow(/win32/);
    expect(() => readFileSync(userFile())).toThrow();
  });
  it("needs the caller to say whether the value is sensitive", () => {
    expect(() => writePluginConfig("kit", "token", SECRET, opts())).toThrow(/sensitive/);
  });
  it.each([["../evil", "k"], ["Kit", "k"], ["kit", "1bad"], ["kit", "a-b"]])("rejects plugin %s key %s", (plugin, key) => {
    expect(() => writePluginConfig(plugin, key, "v", { ...opts(), sensitive: true })).toThrow();
  });
  it("rejects a sensitive value that is not a string", () => expect(() => writePluginConfig("kit", "token", 5, { ...opts(), sensitive: true })).toThrow(/string/));
  it.each([
    [{ pluginConfig: [] }, /pluginConfig must be a mapping/],
    [{ pluginConfig: { Kit: {} } }, /pluginConfig\.Kit is not a plugin name/],
    [{ pluginConfig: { kit: [] } }, /pluginConfig\.kit must be a mapping/],
    [{ pluginConfig: { kit: { "1x": "v" } } }, /pluginConfig\.kit\.1x is not a valid key/],
    [{ pluginConfig: { kit: { k: null } } }, /pluginConfig\.kit\.k must be a string, number, boolean or list of strings/],
  ])("atril.json rejects %j", (bad, why) => {
    expect(() => writeConfig(bad, opts())).toThrow(why);
  });
  it("atril.json without pluginConfig stays free of the field", () => {
    writeConfig({}, opts());
    expect(readFileSync(join(dir, "store", "atril.json"), "utf8")).not.toContain("pluginConfig");
    expect(readConfig(opts())).not.toHaveProperty("pluginConfig");
  });
});

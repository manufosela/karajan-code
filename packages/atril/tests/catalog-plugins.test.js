// ADR 0021, decision 14 and plan step 13a3: a catalog folder that holds a marketplace offers its
// plugins; they are listed and searched without fetching anything.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availablePlugins, findPlugin, sourceDir } from "../src/catalog.js";
import { writeConfig } from "../src/config.js";
import { resolve } from "../src/resolve.js";
import { search } from "../src/search.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-catalog-plugins-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const COMMIT = "b".repeat(40);
const marketplace = (folder, name, plugins) => {
  const file = join(dir, folder, ".claude-plugin", "marketplace.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof plugins === "string" ? plugins : JSON.stringify({ name, plugins }));
};
const gh = (name, description) => ({ name, description, source: { source: "github", repo: `acme/${name}` } });

describe("availablePlugins", () => {
  it("lists a directory catalog's entries with their marketplace and catalog, and no undefined description", () => {
    marketplace("mkt", "acme", [{ name: "tdd-kit", version: "1.0.0", description: "TDD", source: "./plugins/tdd-kit" }, gh("lint")]);
    writeConfig({ catalogs: ["mkt"] }, o());
    expect(availablePlugins(o())).toEqual({ warnings: [], plugins: [
      { name: "tdd-kit", description: "TDD", version: "1.0.0", source: { type: "path", path: join(dir, "mkt", "plugins", "tdd-kit") }, marketplace: "acme", catalog: "mkt" },
      { name: "lint", description: "", version: undefined, source: { type: "github", repo: "acme/lint" }, marketplace: "acme", catalog: "mkt" },
    ] });
  });

  it("a description that is not a string becomes empty", () => {
    marketplace("mkt", "acme", [gh("a", null), gh("b", 5)]);
    writeConfig({ catalogs: ["mkt"] }, o());
    expect(availablePlugins(o()).plugins.map((p) => p.description)).toEqual(["", ""]);
  });

  it("the first catalog wins a shared name", () => {
    marketplace("a", "first", [gh("shared", "from a")]);
    marketplace("b", "second", [gh("shared", "from b")]);
    writeConfig({ catalogs: ["a", "b"] }, o());
    expect(availablePlugins(o()).plugins.map((p) => [p.name, p.catalog])).toEqual([["shared", "a"]]);
  });

  it("skips a broken entry and warns with the catalog, the entry and the reason", () => {
    marketplace("mkt", "acme", [gh("ok"), { name: "bad", source: { source: "npm" } }]);
    writeConfig({ catalogs: ["mkt"] }, o());
    const { plugins, warnings } = availablePlugins(o());
    expect(plugins.map((p) => p.name)).toEqual(["ok"]);
    expect(warnings).toEqual([{ catalog: "mkt", entry: 'plugins[1] ("bad")', reason: expect.stringMatching(/^unknown plugin source/) }]);
  });

  it("an unreadable marketplace.json still throws, naming the catalog", () => {
    marketplace("mkt", "acme", "{nope");
    writeConfig({ catalogs: ["mkt"] }, o());
    expect(() => availablePlugins(o())).toThrow(/catalog "mkt": .*invalid JSON/);
  });

  it("a git source offers its plugins only once fetched, and nothing is written under plugins/", () => {
    writeFileSync(join(dir, "pins.json"), JSON.stringify({ sources: [{ source: "acme/mkt", commit: COMMIT, note: "n" }] }));
    writeConfig({ catalogs: ["pins.json"] }, o());
    expect(availablePlugins(o()).plugins).toEqual([]);
    const cached = sourceDir(o(), { source: "acme/mkt", commit: COMMIT });
    mkdirSync(join(cached, ".claude-plugin"), { recursive: true });
    writeFileSync(join(cached, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "acme", plugins: [gh("lint")] }));
    expect(availablePlugins(o()).plugins.map((p) => p.catalog)).toEqual(["pins.json"]);
    expect(existsSync(join(dir, "store", "plugins"))).toBe(false);
  });
});

describe("search over plugins", () => {
  beforeEach(() => {
    marketplace("mkt", "acme", [gh("tdd-kit", "Red green refactor"), gh("bare"), { name: "bad", source: { source: "npm" } }]);
    writeConfig({ catalogs: ["mkt"] }, o());
  });

  it("a plugin hit is kind plugin, not installed, with its catalog; --kind plugin filters", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(search("refactor", o())).toEqual([
      { name: "tdd-kit", kind: "plugin", description: "Red green refactor", source: "catalog:mkt", installed: false, score: 2, catalog: "mkt" },
    ]);
    expect(search("tdd", { ...o(), kind: "plugin" }).map((hit) => hit.name)).toEqual(["tdd-kit"]);
    expect(search("tdd", { ...o(), kind: "skill" })).toEqual([]);
  });

  it("plugins: false and catalogs: false leave plugins out; no description never matches 'undefined'", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(search("refactor", { ...o(), plugins: false })).toEqual([]);
    expect(search("refactor", { ...o(), catalogs: false })).toEqual([]);
    expect(search("undefined", o())).toEqual([]);
  });

  it("an unknown kind lists plugin among the valid ones", () => {
    expect(() => search("tdd", { ...o(), kind: "bogus" })).toThrow(/plugin/);
  });

  it("a skipped entry reaches onWarning, or stderr, and never stdout", () => {
    const warnings = [];
    search("tdd", { ...o(), onWarning: (warning) => warnings.push(warning) });
    expect(warnings).toEqual([{ catalog: "mkt", entry: 'plugins[2] ("bad")', reason: expect.stringMatching(/^unknown plugin source/) }]);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    search("tdd", o());
    expect(err).toHaveBeenCalledWith(expect.stringContaining('catalog "mkt": plugins[2] ("bad") skipped: unknown plugin source'));
    expect(out).not.toHaveBeenCalled();
  });

  it("onWarning receives the warning alone, not forEach's index and array", () => {
    const onWarning = vi.fn();
    search("tdd", { ...o(), onWarning });
    expect(onWarning.mock.calls.map((args) => args.length)).toEqual([1]);
  });

  it("resolve never proposes a plugin as available", () => {
    expect(resolve({ task: "tdd refactor", ...o() }).available ?? []).toEqual([]);
  });
});
describe("findPlugin", () => {
  it("returns the entry by name, its source ready for fetchPlugin", () => {
    marketplace("a", "first", [gh("lint", "Lint"), gh("fmt")]);
    writeConfig({ catalogs: ["a"] }, o());
    expect(findPlugin("lint", o())).toMatchObject({ name: "lint", catalog: "a", source: { type: "github", repo: "acme/lint" } });
  });
  it("throws naming the catalogs it searched when the name is nowhere", () => {
    marketplace("a", "first", [gh("lint")]);
    writeConfig({ catalogs: ["a"] }, o());
    expect(() => findPlugin("nope", o())).toThrow(/"nope".*atril:recommended, a/);
  });
  it("throws naming both catalogs when two offer the name", () => {
    marketplace("a", "first", [gh("shared")]);
    marketplace("b", "second", [gh("shared")]);
    writeConfig({ catalogs: ["a", "b"] }, o());
    expect(() => findPlugin("shared", o())).toThrow(/"shared" is offered by more than one catalog: a, b$/);
  });
  it("says why when the entry asked for was skipped as broken", () => {
    marketplace("a", "first", [{ name: "bad", source: { source: "npm" } }]);
    writeConfig({ catalogs: ["a"] }, o());
    expect(() => findPlugin("bad", o())).toThrow(/not found.*\(skipped in a: /);
  });
});

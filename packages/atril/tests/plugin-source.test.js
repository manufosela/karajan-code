// ADR 0021, plan step 13a1: where a plugin comes from, and where its copy lives.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMarketplace } from "../src/marketplace.js";
import { parsePluginSource, pluginPaths } from "../src/plugin-source.js";

describe("parsePluginSource", () => {
  it("reads owner/repo with an optional ref", () => {
    expect(parsePluginSource("anthropics/claude-plugins-official")).toEqual({ type: "github", repo: "anthropics/claude-plugins-official" });
    expect(parsePluginSource("acme/kit#v1.2")).toEqual({ type: "github", repo: "acme/kit", ref: "v1.2" });
  });

  it("reads git URLs, a hosted marketplace.json and local paths", () => {
    expect(parsePluginSource("https://git.example.com/acme/kit.git#main")).toEqual({ type: "git", url: "https://git.example.com/acme/kit.git", ref: "main" });
    expect(parsePluginSource("git@github.com:acme/kit.git")).toEqual({ type: "git", url: "git@github.com:acme/kit.git" });
    expect(parsePluginSource("https://example.com/marketplace.json")).toEqual({ type: "marketplace-url", url: "https://example.com/marketplace.json" });
    expect(parsePluginSource("./plugins/tdd")).toEqual({ type: "path", path: "./plugins/tdd" });
    expect(parsePluginSource("/abs/kit")).toEqual({ type: "path", path: "/abs/kit" });
  });

  it("reads the object forms of a Claude Code marketplace entry", () => {
    expect(parsePluginSource({ source: "github", repo: "acme/kit", ref: "v2" })).toEqual({ type: "github", repo: "acme/kit", ref: "v2" });
    expect(parsePluginSource({ source: "github", repo: "acme/kit" })).toEqual({ type: "github", repo: "acme/kit" });
    expect(parsePluginSource({ source: "url", url: "https://git.example.com/kit.git" })).toEqual({ type: "git", url: "https://git.example.com/kit.git" });
    expect(parsePluginSource({ source: "url", url: "https://git.example.com/kit.git", ref: "v3" })).toEqual({ type: "git", url: "https://git.example.com/kit.git", ref: "v3" });
  });

  it("fails on an unknown form and says what it received", () => {
    expect(() => parsePluginSource("not a source")).toThrow(/unknown plugin source: "not a source"/);
    expect(() => parsePluginSource("acme/kit#")).toThrow(/unknown plugin source/);
    expect(() => parsePluginSource({ source: "npm", package: "kit" })).toThrow(/unknown plugin source: \{"source":"npm","package":"kit"\}/);
    expect(() => parsePluginSource({ source: "github", repo: "not-a-repo" })).toThrow(/unknown plugin source/);
    expect(() => parsePluginSource(42)).toThrow(/unknown plugin source: 42/);
  });

  it("rejects a ref git would read as an option and repo segments that walk up", () => {
    for (const spec of ["acme/kit#--upload-pack=x", "acme/kit#a/../b", { source: "github", repo: "acme/kit", ref: 42 }, { source: "github", repo: "../.." }, "acme/..", { source: "github", repo: "../kit" }]) {
      expect(() => parsePluginSource(spec)).toThrow(/unknown plugin source/);
    }
  });

  it("rejects object fields that are not strings, even when they would stringify to a valid one", () => {
    for (const spec of [{ source: "github", repo: ["acme/kit"] }, { source: "url", url: ["https://git.example.com/kit.git"] }]) {
      expect(() => parsePluginSource(spec)).toThrow(/unknown plugin source/);
    }
  });

  it("reads a git-subdir source, with and without a ref", () => {
    const url = "https://github.com/acme/mono.git";
    expect(parsePluginSource({ source: "git-subdir", url, path: "plugins/kit" })).toEqual({ type: "git-subdir", url, path: "plugins/kit" });
    expect(parsePluginSource({ source: "git-subdir", url, path: "kit", ref: "main" })).toEqual({ type: "git-subdir", url, path: "kit", ref: "main" });
  });

  it("reads a 40-hex sha as the commit of github, url and git-subdir sources", () => {
    const sha = "a".repeat(40);
    const url = "https://github.com/acme/mono.git";
    expect(parsePluginSource({ source: "github", repo: "acme/kit", sha })).toEqual({ type: "github", repo: "acme/kit", commit: sha });
    expect(parsePluginSource({ source: "url", url, ref: "v1", sha })).toEqual({ type: "git", url, ref: "v1", commit: sha });
    expect(parsePluginSource({ source: "git-subdir", url, path: "kit", sha })).toEqual({ type: "git-subdir", url, path: "kit", commit: sha });
  });

  it("rejects a sha that is not 40 hex characters, and a git-subdir url or path that escapes", () => {
    const url = "https://github.com/acme/mono.git";
    const bad = [
      { source: "github", repo: "acme/kit", sha: "a".repeat(39) },
      { source: "url", url, sha: "g".repeat(40) },
      { source: "git-subdir", url, path: "kit", sha: 42 },
      { source: "github", repo: "acme/kit", sha: "A".repeat(40) },
      { source: "github", repo: "acme/kit", sha: `${"a".repeat(40)}\n` },
      { source: "github", repo: "acme/kit", sha: null },
      { source: "github", repo: "acme/kit", sha: "" },
      { source: "git-subdir", url, path: "kit\n" },
      { source: "git-subdir", url, path: "a//b" },
      { source: "git-subdir", url, path: "a/" },
      { source: "git-subdir", url, path: "a/./b" },
      { source: "git-subdir", url, path: "a/.." },
      { source: "git-subdir", url, path: "a\\b" },
      { source: "git-subdir", url, path: "kit", ref: "-x" },
      { source: "git-subdir", url: ["https://github.com/acme/mono.git"], path: "kit" },
      { source: "git-subdir", url, path: "../x" },
      { source: "git-subdir", url, path: "a/../x" },
      { source: "git-subdir", url, path: "/abs" },
      { source: "git-subdir", url, path: "./kit" },
      { source: "git-subdir", url, path: "" },
      { source: "git-subdir", url, path: ["kit"] },
      { source: "git-subdir", url: "not-a-git-url", path: "kit" },
      { source: "git-subdir", path: "kit" },
    ];
    for (const spec of bad) expect(() => parsePluginSource(spec)).toThrow(/unknown plugin source/);
  });

  it("lets readMarketplace read one entry of each shape the official marketplace uses", () => {
    const dir = mkdtempSync(join(tmpdir(), "atril-plugin-source-"));
    try {
      const sha = "b".repeat(40);
      const url = "https://github.com/acme/mono.git";
      mkdirSync(join(dir, ".claude-plugin"));
      writeFileSync(join(dir, ".claude-plugin", "marketplace.json"), JSON.stringify({
        name: "official",
        plugins: [
          { name: "local", source: "./plugins/local" },
          { name: "pinned", source: { source: "url", url, sha } },
          { name: "nested", source: { source: "git-subdir", url, path: "plugins/nested", ref: "main", sha } },
        ],
      }));
      expect(readMarketplace(dir).plugins.map((plugin) => plugin.source)).toEqual([
        { type: "path", path: join(dir, "plugins", "local") },
        { type: "git", url, commit: sha },
        { type: "git-subdir", url, path: "plugins/nested", ref: "main", commit: sha },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parsePluginSource, a source already normalized", () => {
  const COMMIT = "a".repeat(40);
  const normalized = [
    { type: "github", repo: "acme/kit", ref: "v2", commit: COMMIT },
    { type: "git", url: "https://git.example.com/acme/kit.git" },
    { type: "git-subdir", url: "git@github.com:acme/kit.git", path: "plugins/kit", commit: COMMIT },
    { type: "path", path: "/abs/kit" },
    { type: "marketplace-url", url: "https://example.com/marketplace.json" },
  ];
  it.each(normalized)("comes back unchanged: $type", (source) => {
    expect(parsePluginSource(source)).toEqual(source);
  });
  it("round-trips whatever readMarketplace returns", () => {
    const dir = mkdtempSync(join(tmpdir(), "atril-source-roundtrip-"));
    try {
      mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
      const plugins = [{ name: "a", source: { source: "github", repo: "acme/a", sha: COMMIT } }, { name: "b", source: "./plugins/b" }];
      writeFileSync(join(dir, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "m", plugins }));
      for (const { source } of readMarketplace(dir).plugins) expect(parsePluginSource(source)).toEqual(source);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it.each([
    { type: "npm", package: "kit" },
    { type: "github" },
    { type: "github", repo: "../evil" },
    { type: "github", repo: "acme/kit", ref: "--upload-pack=x" },
    { type: "github", repo: "acme/kit", commit: "abc" },
    { type: "git", url: "ftp://example.com/kit" },
    { type: "git-subdir", url: "https://git.example.com/kit.git", path: "../up" },
    { type: "path", path: "" },
    { type: "path", path: "no-prefix" },
    { type: "path", path: "/x", commit: "a".repeat(40) },
    { type: "marketplace-url", url: "https://example.com/m.json", ref: "main" },
    { type: "__proto__" },
    { type: "constructor", repo: "acme/kit" },
    { type: null },
    { type: "github", repo: {} },
    { type: "github", repo: "acme/kit", commit: "A".repeat(40) },
    { type: "marketplace-url", url: "https://example.com/readme.md" },
  ])("rejects a malformed one: %j", (source) => {
    expect(() => parsePluginSource(source)).toThrow(/unknown plugin source/);
  });
});

describe("pluginPaths", () => {
  it("places a plugin under <root>/plugins/<name>/<version>", () => {
    expect(pluginPaths("/r", "tdd-kit", "1.2.0")).toEqual({ base: join("/r", "plugins", "tdd-kit"), dir: join("/r", "plugins", "tdd-kit", "1.2.0") });
    expect(pluginPaths("/r", "kit", "1.0.0-rc.1+b2").dir).toBe(join("/r", "plugins", "kit", "1.0.0-rc.1+b2"));
  });

  it("rejects a name or a version that escapes the cache", () => {
    for (const [name, version] of [["..", "1.0.0"], ["a/b", "1.0.0"], ["Kit", "1.0.0"], ["kit", ".."], ["kit", "1/2"], ["kit", "1\\2"], ["kit", ""], ["kit", "..."], ["kit", undefined]]) {
      expect(() => pluginPaths("/r", name, version)).toThrow(/plugin (name|version)/);
    }
  });
});

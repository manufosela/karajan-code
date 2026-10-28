// ADR 0021, plan step 13a1: a marketplace is read and its entries normalized. Reading only.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMarketplace } from "../src/marketplace.js";

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-marketplace-"));
  file = join(dir, ".claude-plugin", "marketplace.json");
  mkdirSync(join(dir, ".claude-plugin"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const write = (content) => writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));

describe("readMarketplace", () => {
  it("reads the name and normalizes every entry, resolving relative paths against the marketplace", () => {
    write({ name: "acme", plugins: [
      { name: "tdd-kit", version: "1.0.0", description: "TDD", source: "./plugins/tdd-kit" },
      { name: "lint", source: { source: "github", repo: "acme/lint", ref: "v2" } },
    ] });
    expect(readMarketplace(dir)).toEqual({ name: "acme", plugins: [
      { name: "tdd-kit", version: "1.0.0", description: "TDD", source: { type: "path", path: join(dir, "plugins", "tdd-kit") } },
      { name: "lint", version: undefined, description: undefined, source: { type: "github", repo: "acme/lint", ref: "v2" } },
    ] });
  });

  it("fails with the file path when it is missing or not JSON", () => {
    expect(() => readMarketplace(dir)).toThrow(file);
    write("{nope");
    expect(() => readMarketplace(dir)).toThrow(`${file}: invalid JSON`);
  });

  it("validates the name and the plugins list", () => {
    write({ plugins: [] });
    expect(() => readMarketplace(dir)).toThrow(`${file}: a marketplace needs a name`);
    write({ name: "acme", plugins: {} });
    expect(() => readMarketplace(dir)).toThrow(`${file}: a marketplace needs a plugins list`);
  });

  it("names the entry that fails", () => {
    write({ name: "acme", plugins: [{ name: "ok", source: "./ok" }, { name: "bad", source: { source: "npm" } }] });
    expect(() => readMarketplace(dir)).toThrow(`${file}: plugins[1] ("bad"): unknown plugin source`);
    write({ name: "acme", plugins: [{ name: "../x", source: "./x" }] });
    expect(() => readMarketplace(dir)).toThrow(`${file}: plugins[0] ("../x"): a plugin needs a name`);
  });

  it.each(["../outside", "/etc", "./"])("rejects a plugin path that leaves the marketplace: %s", (source) => {
    write({ name: "acme", plugins: [{ name: "evil", source }] });
    expect(() => readMarketplace(dir)).toThrow(`${file}: plugins[0] ("evil"): a plugin path must stay inside the marketplace`);
  });

  it("with onSkip, a broken entry is skipped and reported, and the rest is read", () => {
    write({ name: "acme", plugins: [{ name: "ok", source: "./ok" }, { name: "bad", source: { source: "npm" } }, { name: "ok", source: "./b" }] });
    const skipped = [];
    const { plugins } = readMarketplace(dir, { onSkip: (skip) => skipped.push(skip) });
    expect(plugins.map((plugin) => plugin.name)).toEqual(["ok"]);
    expect(skipped).toEqual([
      { index: 1, name: "bad", reason: expect.stringMatching(/^unknown plugin source/) },
      { index: 2, name: "ok", reason: "a plugin name appears twice" },
    ]);
    write("{nope");
    expect(() => readMarketplace(dir, { onSkip: () => {} })).toThrow(`${file}: invalid JSON`);
  });

  it("rejects a plugin name that appears twice", () => {
    write({ name: "acme", plugins: [{ name: "dup", source: "./a" }, { name: "dup", source: "./b" }] });
    expect(() => readMarketplace(dir)).toThrow(`${file}: plugins[1] ("dup"): a plugin name appears twice`);
  });
});

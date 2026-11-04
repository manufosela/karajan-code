// ADR 0021 decision 14 and ADR 0042: the derived plugin is written and listed; no host CLI is ever run.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { derivedInstructions, writeDerived } from "../src/plugin-derived.js";

let dir, src;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-derived-"));
  src = join(dir, "copy");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel, content) => {
  mkdirSync(dirname(join(src, rel)), { recursive: true });
  writeFileSync(join(src, rel), JSON.stringify(content));
};
const read = (...parts) => JSON.parse(readFileSync(join(dir, "plugins", ...parts), "utf8"));
const HOOKS = { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] } };

describe("writeDerived", () => {
  it("writes manifest, hooks and a flat .mcp.json wrapped, plus the local marketplace, only under plugins/", () => {
    put("hooks/hooks.json", HOOKS);
    put(".mcp.json", { db: { command: "srv" } });
    const derived = writeDerived("kit", "1.0.0", src, { root: dir, hooks: 1, mcpServers: 1 });
    const base = join("kit", "derived");
    expect(read(base, ".claude-plugin", "plugin.json")).toEqual({ name: "kit", version: "1.0.0" });
    expect(read(base, "hooks", "hooks.json")).toEqual(HOOKS);
    expect(read(base, ".mcp.json")).toEqual({ mcpServers: { db: { command: "srv" } } });
    expect(read(".claude-plugin", "marketplace.json").plugins).toEqual([{ name: "kit", source: "./kit/derived" }]);
    expect(derived).toMatchObject({ name: "kit", marketplace: join(dir, "plugins") });
    expect(derived.commands.map(({ cli }) => cli)).toEqual(["claude", "agy"]);
  });

  it("starts every marketplace source with ./ and points it at a folder inside the marketplace root, for hooks and for MCP", () => {
    put("hooks/hooks.json", HOOKS);
    writeDerived("hooked", "1.0.0", src, { root: dir, hooks: 1, mcpServers: 0 });
    rmSync(join(src, "hooks"), { recursive: true });
    put(".mcp.json", { db: { command: "srv" } });
    writeDerived("served", "1.0.0", src, { root: dir, hooks: 0, mcpServers: 1 });
    const { plugins } = read(".claude-plugin", "marketplace.json");
    expect(plugins.map(({ name }) => name)).toEqual(["hooked", "served"]);
    for (const { source } of plugins) {
      expect(source).toMatch(/^\.\/[^.]/);
      expect(existsSync(join(dir, "plugins", source, ".claude-plugin", "plugin.json"))).toBe(true);
    }
  });

  it("replaces a 1.4.0 marketplace (../ entries, under .marketplace) with the new layout and deletes the old folder", () => {
    const old = join(dir, "plugins", ".marketplace", ".claude-plugin", "marketplace.json");
    mkdirSync(dirname(old), { recursive: true });
    writeFileSync(old, JSON.stringify({ name: "atril", owner: { name: "atril" }, plugins: [{ name: "other", source: "../other/derived" }, { name: "kit", source: "../kit/derived" }] }));
    put("hooks/hooks.json", HOOKS);
    writeDerived("kit", "1.0.0", src, { root: dir, hooks: 1, mcpServers: 0 });
    expect(read(".claude-plugin", "marketplace.json").plugins).toEqual([{ name: "other", source: "./other/derived" }, { name: "kit", source: "./kit/derived" }]);
    expect(existsSync(join(dir, "plugins", ".marketplace"))).toBe(false);
  });

  it("produces nothing for a plugin with no hooks and no MCP", () => {
    expect(writeDerived("kit", "1.0.0", src, { root: dir, hooks: 0, mcpServers: 0 })).toBeUndefined();
    expect(existsSync(join(dir, "plugins"))).toBe(false);
  });

  it("drops a stale derived plugin and its marketplace entry when a reinstall has no hooks and no MCP", () => {
    put("hooks/hooks.json", HOOKS);
    writeDerived("kit", "1.0.0", src, { root: dir, hooks: 1, mcpServers: 0 });
    expect(writeDerived("kit", "1.1.0", src, { root: dir, hooks: 0, mcpServers: 0 })).toBeUndefined();
    expect(existsSync(join(dir, "plugins", "kit", "derived"))).toBe(false);
    expect(read(".claude-plugin", "marketplace.json").plugins).toEqual([]);
  });

  it("drops a stale hooks.json when the new version keeps only MCP", () => {
    put("hooks/hooks.json", HOOKS);
    writeDerived("kit", "1.0.0", src, { root: dir, hooks: 1, mcpServers: 0 });
    rmSync(join(src, "hooks"), { recursive: true });
    put(".mcp.json", { mcpServers: { db: { command: "srv" } } });
    writeDerived("kit", "1.1.0", src, { root: dir, hooks: 0, mcpServers: 1 });
    expect(existsSync(join(dir, "plugins", "kit", "derived", "hooks"))).toBe(false);
  });

  it("single-quotes the paths in the commands", () => {
    put("hooks/hooks.json", HOOKS);
    const root = join(dir, "my root; echo 'x'");
    const { commands } = writeDerived("kit", "1.0.0", src, { root, hooks: 1, mcpServers: 0 });
    expect(commands[1].command).toBe(`agy plugin install '${join(root, "plugins", "kit", "derived").replaceAll("'", "'\\''")}'`);
    expect(commands[0].command).toContain("install 'kit@atril'");
  });

  it.each([
    ["a hook script", "hooks/hooks.json", { hooks: { Stop: [{ hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/check.sh" }] }] } }],
    ["an MCP server in node_modules", ".mcp.json", { db: { command: "node", args: ["node_modules/srv/index.js"] } }],
    ["a bin/ command", ".mcp.json", { db: { command: "bin/serve" } }],
  ])("marks the derived plugin withoutAssets when %s is referenced, and still shows the commands", (_label, file, content) => {
    put(file, content);
    const derived = writeDerived("kit", "1.0.0", src, { root: dir, hooks: 1, mcpServers: 1 });
    expect(derived.withoutAssets).toBe(true);
    expect(derived.commands).toHaveLength(2);
    expect(JSON.parse(JSON.stringify({ derived })).derived.withoutAssets).toBe(true);
    expect(derivedInstructions(derived).join("\n")).toMatch(/without assets.*may not work/);
  });

  it("raises no warning for a derived plugin whose commands reference no scripts", () => {
    put("hooks/hooks.json", HOOKS);
    const derived = writeDerived("kit", "1.0.0", src, { root: dir, hooks: 1, mcpServers: 0 });
    expect(derived).not.toHaveProperty("withoutAssets");
    expect(derivedInstructions(derived).join("\n")).not.toMatch(/without assets/);
  });

  it("rejects a name that would escape plugins/", () => {
    put("hooks/hooks.json", HOOKS);
    expect(() => writeDerived("../evil", "1.0.0", src, { root: dir, hooks: 1, mcpServers: 0 })).toThrow(/invalid plugin name/);
  });
});

describe("derivedInstructions", () => {
  it("names each command and says atril runs none", () => {
    const lines = derivedInstructions({ name: "kit", marketplace: "/m", path: "/m/../kit/derived", commands: [{ cli: "claude", command: "claude plugin install kit@atril" }] });
    expect(lines.join("\n")).toMatch(/claude: claude plugin install kit@atril/);
    expect(lines.join("\n")).toMatch(/atril runs none/);
  });
});

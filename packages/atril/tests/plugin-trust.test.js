// ADR 0021, decision 14 (step 13g2-i): what a plugin runs is listed, as data and as safe-to-print text.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatInventory, pluginInventory } from "../src/plugin-trust.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-trust-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (rel, value = "") => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), typeof value === "string" ? value : JSON.stringify(value));
};
const plugin = (manifest = {}) => {
  write(".claude-plugin/plugin.json", { name: "demo", version: "1.0.0", ...manifest });
  return pluginInventory(dir);
};
const cmd = (command, extra) => ({ type: "command", command, ...extra });
const group = (matcher, ...hooks) => ({ matcher, hooks });
const char = (code) => String.fromCodePoint(code);

describe("pluginInventory", () => {
  it("lists nothing for a manifest-only plugin and prints every section as none", () => {
    const inventory = plugin();
    expect(inventory).toEqual({ name: "demo", version: "1.0.0", format: "claude", hooks: [], mcpServers: [], bin: [] });
    const text = formatInventory(inventory);
    expect(text).toContain('plugin demo "1.0.0" (claude)\n');
    expect(formatInventory(inventory, { source: { repo: "o/r" }, commit: "abcdefabcdef0123" })).toContain('from "o/r" at "abcdefabcdef…"');
    for (const section of ["hooks: none", "mcp servers: none", "executables on PATH (bin/): none"]) expect(text).toContain(section);
  });

  it("lists hooks in load order (default file, manifest path, inline), each type with its own fields", () => {
    write("hooks/hooks.json", { hooks: { A: [group("Bash", cmd("a"), cmd("b", { args: ["x"] }), { type: "http", url: "https://h" })] } });
    write("config/h.json", { hooks: { B: [group("", { type: "mcp_tool", server: "s", tool: "t" }, { type: "weird", x: 1 })] } });
    const hooks = plugin({ hooks: ["./config/h.json", { C: [group("m", { type: "prompt", prompt: "p" })] }] }).hooks;
    expect(hooks.map(({ source, event, matcher, type, ...rest }) => [source, event, matcher, type, rest])).toEqual([
      ["hooks/hooks.json", "A", "Bash", "command", { command: "a" }],
      ["hooks/hooks.json", "A", "Bash", "command", { command: "b", args: ["x"] }],
      ["hooks/hooks.json", "A", "Bash", "http", { url: "https://h" }],
      ["config/h.json", "B", "", "mcp_tool", { server: "s", tool: "t" }],
      ["config/h.json", "B", "", "weird", { raw: '{"type":"weird","x":1}' }],
      ["plugin.json", "C", "m", "prompt", { prompt: "p" }],
    ]);
  });

  it("throws, naming the file, on invalid JSON, a missing wrapper or a path that leaves the plugin or is missing", () => {
    write("config/h.json", { A: [] });
    expect(() => plugin({ hooks: "./config/h.json" })).toThrow("config/h.json");
    expect(() => plugin({ hooks: "../x.json" })).toThrow("escapes the plugin");
    expect(() => plugin({ mcpServers: "./nope.json" })).toThrow("not found");
    write("hooks/hooks.json", "{ nope");
    expect(() => plugin()).toThrow("hooks.json");
  });

  it("lists flat, wrapped and inline MCP servers, with only the env keys", () => {
    write(".mcp.json", { gh: { type: "http", url: "https://api.example/mcp", headersHelper: "get-token" } });
    write("config/m.json", { mcpServers: { db: { command: "npx", args: ["db"], env: { MODE: "never-printed" } } } });
    const servers = plugin({ mcpServers: ["./config/m.json", { inline: { command: "node", args: ["s.js"] } }] }).mcpServers;
    expect(servers).toEqual([
      expect.objectContaining({ source: ".mcp.json", name: "gh", type: "http", url: "https://api.example/mcp", headersHelper: "get-token" }),
      expect.objectContaining({ source: "config/m.json", name: "db", type: "stdio", command: "npx", args: ["db"], env: ["MODE"] }),
      expect.objectContaining({ source: "plugin.json", name: "inline", type: "stdio", command: "node" }),
    ]);
    expect(formatInventory(plugin({ mcpServers: "./config/m.json" }))).not.toContain("never-printed");
    write("bin/b"); write("bin/a"); write("bin/C");
    expect(plugin().bin).toEqual(["bin/C", "bin/a", "bin/b"]);
  });
});

describe("formatInventory", () => {
  it("escapes every string the plugin wrote, deterministically and without absolute paths", () => {
    write("hooks/hooks.json", { hooks: { E: [group(char(0x202e), cmd(`rm -rf /${char(0x1b)}[2J${char(0x2028)}`, { args: [char(0x85)] }))] } });
    write("bin/evil\nname");
    const text = formatInventory(plugin({ version: `1${char(0x200b)}.0` }));
    expect(formatInventory(plugin({ version: `1${char(0x200b)}.0` }))).toBe(text);
    expect(text).not.toContain(dir);
    for (const escaped of ["\\u001b", "\\u202e", "\\u2028", "\\u0085", "\\u200b", "evil\\nname"]) expect(text).toContain(escaped);
    expect(text.replaceAll("\n", "")).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("refuses a default or manifest file that links outside the plugin", () => {
    const out = mkdtempSync(join(tmpdir(), "atril-trust-out-"));
    writeFileSync(join(out, "x.json"), "{}");
    symlinkSync(join(out, "x.json"), join(dir, "h.json"));
    expect(() => plugin({ hooks: "./h.json" })).toThrow("escapes the plugin");
    rmSync(join(dir, "h.json"));
    symlinkSync(join(out, "x.json"), join(dir, ".mcp.json"));
    expect(() => plugin()).toThrow("escapes the plugin");
    rmSync(out, { recursive: true, force: true });
  });

  it("shows non-string values, escapes tag characters and escapes the strings in errors", () => {
    write("hooks/hooks.json", { hooks: { E: [group("m", cmd({ rm: 1 }, { args: ["a", { b: 2 }, `x${char(0xe0041)}`] }))] } });
    const text = formatInventory(plugin());
    for (const shown of ['{\\"rm\\":1}', '{\\"b\\":2}', "\\u{e0041}"]) expect(text).toContain(shown);
    expect(() => plugin({ hooks: `${char(0x9b)}2J${char(0x202e)}` })).toThrow(/\\u009b2J\\u202e/);
    expect(() => { write(`h${char(0x9b)}.json`, { A: [] }); plugin({ hooks: `./h${char(0x9b)}.json` }); }).toThrow("h\\u009b.json");
  });

  it("imports no process, network or write API", () => {
    const code = readFileSync(new URL("../src/plugin-trust.js", import.meta.url), "utf8");
    expect(code).not.toMatch(/child_process|node:(http|https|net|dgram|worker_threads)|\bfetch\(|promises|\b(write|append|mkdir|rm|rmdir|unlink|rename|copyFile|chmod|symlink)\w*\(/i);
  });
});

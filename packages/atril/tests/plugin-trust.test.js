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
    expect(inventory).toEqual({ name: "demo", version: "1.0.0", format: "claude", hooks: [], mcpServers: [], bin: [], npm: { status: "none", packages: [] }, variables: [] });
    const text = formatInventory(inventory);
    expect(text).toContain('plugin demo "1.0.0" (claude)\n');
    expect(formatInventory(inventory, { source: { repo: "o/r" }, commit: "abcdefabcdef0123" })).toContain('from "o/r" at "abcdefabcdef…"');
    for (const section of ["hooks: none", "mcp servers: none", "executables on PATH (bin/): none", "npm packages: none", "unresolved variables: none"]) expect(text).toContain(section);
  });

  it("lists hooks in load order (default file, manifest path, inline), each type with its own fields", () => {
    write("hooks/hooks.json", { hooks: { A: [group("Bash", cmd("a"), cmd("b", { args: ["x"] }), { type: "http", url: "https://h" })] } });
    write("config/h.json", { hooks: { B: [group("", { type: "mcp_tool", server: "s", tool: "t" }, { type: "weird", x: 1 })] } });
    const hooks = plugin({ hooks: ["./config/h.json", { C: [group("m", { type: "prompt", prompt: "p" })] }] }).hooks;
    expect(hooks.map(({ source, event, matcher, type, ...rest }) => [source, event, matcher, type, rest])).toEqual([
      ["hooks/hooks.json", "A", "Bash", "command", { command: "a" }],
      ["hooks/hooks.json", "A", "Bash", "command", { command: "b", args: ["x"] }],
      ["hooks/hooks.json", "A", "Bash", "http", { url: "https://h" }],
      ["config/h.json", "B", "", "mcp_tool", { server: "s", tool: "t", status: "not installed: declared in plugin.json" }],
      ["config/h.json", "B", "", "weird", { raw: '{"type":"weird","x":1}', status: "not installed: declared in plugin.json" }],
      ["plugin.json", "C", "m", "prompt", { prompt: "p", status: "not installed: declared in plugin.json" }],
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

describe("npm packages and variables", () => {
  const pkg = { dependencies: { left: "^1.0.0" }, optionalDependencies: { right: "2.x" } };

  it("lists the npm packages with the install status, and why nothing is installed", () => {
    write("package.json", pkg);
    expect(plugin().npm).toEqual({ status: "unsupported", reason: "no lockfile", packages: [{ name: "left", range: "^1.0.0" }, { name: "right", range: "2.x" }] });
    expect(formatInventory(plugin())).toContain('npm packages (2):\n  name "left" range "^1.0.0"\n  name "right" range "2.x"\n  not installed: "no lockfile"\n');
    write("package-lock.json", { lockfileVersion: 3 });
    expect(plugin().npm.status).toBe("ready");
    expect(formatInventory(plugin())).not.toContain("not installed");
  });

  it("lists a package once when both dependency fields name it, the optional one winning", () => {
    write("package.json", { dependencies: { left: "1.x" }, optionalDependencies: { left: "2.x" } });
    expect(plugin().npm.packages).toEqual([{ name: "left", range: "2.x" }]);
  });

  it("never prints a lockfile's free text raw", () => {
    write("package.json", pkg);
    write("package-lock.json", { lockfileVersion: `2${char(0x1b)}[31m\nhooks: none` });
    const text = formatInventory(plugin());
    expect(text).not.toContain(char(0x1b));
    const line = text.split("\n").find((l) => l.startsWith("  not installed:"));
    expect(line).toContain("\\u001b[31m\\nhooks: none");
  });

  const entry = (extra = "", body = "") => `---\ndescription: d\n${extra}---\n${body}`;

  it("lists what the install leaves as written, per entry, as printable text", () => {
    write("commands/run.md", entry("", "run ${user_config.token} in ${CLAUDE_SKILL_DIR} at ${PLUGIN_ROOT}"));
    write("skills/s/SKILL.md", entry("", "${CLAUDE_SKILL_DIR} ${user_config.key}"));
    expect(plugin().variables).toEqual([
      { ref: "demo:s", variable: "user_config.key", reason: "undeclared" },
      { ref: "demo:run", variable: "user_config.token", reason: "undeclared" },
      { ref: "demo:run", variable: "CLAUDE_SKILL_DIR", reason: "skill-only" },
    ]);
    expect(formatInventory(plugin())).toContain('unresolved variables (3):\n  ref "demo:s" variable "user_config.key" reason "undeclared"');
  });

  it("scans the body and allowed-tools only, as the install substitutes them", () => {
    write("commands/run.md", entry('allowed-tools: ["Bash(${user_config.tool})"]\ndescription2: ${user_config.ignored}\n', "plain"));
    expect(plugin().variables).toEqual([{ ref: "demo:run", variable: "user_config.tool", reason: "undeclared" }]);
  });

  it("refuses an entry that is a symlink out of the plugin", () => {
    write("../outside.md", entry("", "${user_config.x}"));
    mkdirSync(join(dir, "commands"));
    symlinkSync(join(dir, "..", "outside.md"), join(dir, "commands", "run.md"));
    expect(() => plugin()).toThrow(/escapes the plugin/);
  });

  it("marks hooks declared in plugin.json as not installed, because the hook loader rejects them", () => {
    write("hooks/hooks.json", { hooks: { A: [group("m", cmd("a"))] } });
    const declared = { C: [group("m", cmd("c"))] };
    expect(plugin({ hooks: declared }).hooks.map((hook) => hook.status)).toEqual([undefined, "not installed: declared in plugin.json"]);
    expect(formatInventory(plugin({ hooks: declared }))).toContain('status "not installed: declared in plugin.json"');
  });
  it("marks every hook of a Codex plugin as not installed", () => {
    write(".codex-plugin/plugin.json", { name: "demo", version: "1.0.0" });
    write("hooks/hooks.json", { hooks: { A: [group("m", cmd("a"))] } });
    expect(pluginInventory(dir).hooks.map((hook) => hook.status)).toEqual(["not installed: codex plugins are native-only"]);
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

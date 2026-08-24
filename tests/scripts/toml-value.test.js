// KJC-BUG-0151 (issue #1426, reported by dfosela on Windows 11) — kj wrote the
// karajan-mcp block into ~/.codex/config.toml with raw Windows paths inside
// double-quoted TOML strings. `\U` in `C:\Users\…` is read as a unicode escape,
// the file stops parsing, and codex fails to load its ENTIRE config — including
// `codex login`. kj believed it had configured the MCP; what it had done was
// break a tool the user never touched.
import { describe, it, expect } from "vitest";
import { parse } from "smol-toml";
import { tomlPath } from "../../scripts/toml-value.js";

describe("a path as a TOML value", () => {
  it("writes a Windows path so that TOML does not read escapes in it", () => {
    const windows = "C:\\Users\\dfosela\\AppData\\Roaming\\npm\\node_modules\\karajan-code";
    expect(tomlPath(windows)).toBe(`'${windows}'`);
    expect(tomlPath(windows)).not.toContain('"'); // a basic string is what caused the bug
  });

  it("leaves a POSIX path exactly as it is", () => {
    expect(tomlPath("/home/manu/ws/karajan-code/src/mcp/server.js")).toBe("'/home/manu/ws/karajan-code/src/mcp/server.js'");
  });

  it("a path containing a single quote falls back to the basic form, properly escaped", () => {
    // A literal string cannot contain a single quote, so here the escapes are real work.
    expect(tomlPath("C:\\Users\\o'brien\\kj")).toBe('"C:\\\\Users\\\\o\'brien\\\\kj"');
    expect(tomlPath('/home/o\'brien/say "hi"')).toBe('"/home/o\'brien/say \\"hi\\""');
  });

  // The bug WAS "we generate invalid TOML", so the only honest test parses it back.
  it("the generated block is valid TOML and gives back the exact paths", () => {
    const root = "C:\\Users\\dfosela\\AppData\\Roaming\\npm\\node_modules\\karajan-code";
    const server = `${root}\\src\\mcp\\server.js`;
    const home = `${root}\\.karajan`;
    const block = [
      '[mcp_servers."karajan-mcp"]',
      'command = "node"',
      `args = [${tomlPath(server)}]`,
      `cwd = ${tomlPath(root)}`,
      '[mcp_servers."karajan-mcp".env]',
      `KJ_HOME = ${tomlPath(home)}`,
    ].join("\n");

    const parsed = parse(block); // this threw "too few unicode value digits" before the fix
    expect(parsed.mcp_servers["karajan-mcp"]).toMatchObject({ command: "node", args: [server], cwd: root });
    expect(parsed.mcp_servers["karajan-mcp"].env.KJ_HOME).toBe(home);
  });

  it("round-trips every shape of path, quotes included", () => {
    for (const p of ["C:\\Users\\a\\b", "/home/x/y.js", "C:\\Users\\o'brien\\kj", '/home/say "hi"']) {
      expect(parse(`cwd = ${tomlPath(p)}`).cwd).toBe(p);
    }
  });
});

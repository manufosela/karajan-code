// ADR 0021, plan step 13b1: a plugin is normalized before `rulesync import`
// (flat .mcp.json wrapped) and its server count kept for the check after it;
// lossyFields reports what the import would drop.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countServers, lossyFields, normalizePlugin, prepareImport, wrapMcp } from "../src/plugin-normalize.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-normalize-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (rel, value) => {
  const file = join(dir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};

const read = (rel) => JSON.parse(readFileSync(join(dir, rel), "utf8"));
const server = { command: "npx", args: ["srv"] };

describe("countServers", () => {
  it("counts wrapped and flat shapes alike", () => {
    expect(countServers({ mcpServers: { a: server, b: server } })).toBe(2);
    expect(countServers({ a: server })).toBe(1);
    expect(countServers({})).toBe(0);
  });

  it("throws on a non-object or an invalid entry", () => {
    expect(() => countServers([])).toThrow("must be a JSON object");
    expect(() => countServers({ mcpServers: [] })).toThrow("mcpServers must be an object");
    expect(() => countServers({ a: "npx srv" })).toThrow('server "a"');
    expect(() => countServers({ mcpServers: {}, b: server })).toThrow("neither flat nor wrapped");
  });
});

describe("wrapMcp", () => {
  it("wraps a flat object without mutating it", () => {
    const flat = { a: server };
    expect(wrapMcp(flat)).toEqual({ mcpServers: { a: server } });
    expect(flat).toEqual({ a: server });
  });

  it("returns an already wrapped object unchanged", () => {
    const wrapped = { mcpServers: { a: server } };
    expect(wrapMcp(wrapped)).toBe(wrapped);
  });
});

describe("prepareImport", () => {
  it("rewrites a flat .mcp.json wrapped and counts its servers", () => {
    write(".mcp.json", { a: server, b: server });
    expect(prepareImport(dir)).toEqual({ servers: 2, wrapped: true });
    expect(read(".mcp.json")).toEqual({ mcpServers: { a: server, b: server } });
  });

  it("leaves a wrapped .mcp.json untouched", () => {
    const text = JSON.stringify({ mcpServers: { a: server } });
    write(".mcp.json", text);
    expect(prepareImport(dir)).toEqual({ servers: 1, wrapped: false });
    expect(readFileSync(join(dir, ".mcp.json"), "utf8")).toBe(text);
  });

  it("reports no servers when there is no .mcp.json", () => {
    expect(prepareImport(dir)).toEqual({ servers: 0, wrapped: false });
  });

  it("throws with the path on invalid JSON", () => {
    write(".mcp.json", "{ nope");
    expect(() => prepareImport(dir)).toThrow(join(dir, ".mcp.json"));
  });
});
describe("lossyFields", () => {
  const manifest = (extra = {}) => write(".claude-plugin/plugin.json", { name: "kit", ...extra });

  it("is empty for a plugin the import keeps whole", () => {
    manifest();
    write("hooks/hooks.json", { hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } });
    expect(lossyFields(dir)).toEqual([]);
  });

  it("reports modules and rewake fields in hooks.json, sorted", () => {
    manifest();
    write("hooks/hooks.json", {
      modules: ["m"],
      hooks: {
        Stop: [{ hooks: [{ command: "x", rewakeSummary: "s" }] }],
        PreToolUse: [{ matcher: "*", hooks: [{ command: "y" }, { command: "z", rewakeMessage: "m" }] }],
      },
    });
    const file = join("hooks", "hooks.json");
    expect(lossyFields(dir)).toEqual([
      { file, field: "rewakeMessage", where: "hooks.PreToolUse[0].hooks[1]" },
      { file, field: "rewakeSummary", where: "hooks.Stop[0].hooks[0]" },
      { file, field: "modules", where: "modules" },
    ]);
  });

  it("throws when hooks.json is not an object", () => {
    manifest();
    write("hooks/hooks.json", []);
    expect(() => lossyFields(dir)).toThrow("must be a JSON object");
  });

  it("reports inline hooks and mcpServers in the manifest, not path strings", () => {
    manifest({ hooks: {}, mcpServers: {}, commands: "./x" });
    expect(lossyFields(dir)).toHaveLength(2);
    manifest({ hooks: "./hooks/hooks.json", mcpServers: {} });
    expect(lossyFields(dir)).toHaveLength(1);
    manifest({ hooks: {}, mcpServers: {} });
    expect(lossyFields(dir)).toEqual([
      { file: "plugin.json", field: "hooks", where: "claude manifest" },
      { file: "plugin.json", field: "mcpServers", where: "claude manifest" },
    ]);
  });
});

describe("normalizePlugin", () => {
  const claude = () => write(".claude-plugin/plugin.json", { name: "kit" });
  // A fake rulesync: records each call and, like the import, writes .rulesync/mcp.json under --output-root.
  // count === null writes nothing (an import that produced no mcp.json).
  const fake = (count, raw) => {
    const calls = [];
    const run = (cmd, args, cwd) => {
      calls.push({ cmd, args, cwd });
      if (count === null) return;
      const root = args[args.indexOf("--output-root") + 1];
      const mcpServers = Object.fromEntries(Array.from({ length: count }, (_, i) => [`s${i}`, server]));
      mkdirSync(join(root, ".rulesync"), { recursive: true });
      writeFileSync(join(root, ".rulesync", "mcp.json"), raw ?? JSON.stringify({ mcpServers }));
    };
    return { calls, run };
  };
  const opts = () => ({ projectDir: join(dir, "project") });

  it("imports a claude plugin with the absolute output root, wrapping a flat .mcp.json", () => {
    claude();
    write(".mcp.json", { a: server, b: server });
    const { calls, run } = fake(2);
    expect(normalizePlugin(dir, opts(), run)).toEqual({
      status: "split", source: join(dir, ".rulesync"), target: "claudecode-plugin", servers: 2, wrapped: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].args.slice(-5)).toEqual(["import", "--targets", "claudecode-plugin", "--output-root", dir]);
    expect(calls[0].cwd).toBe(join(dir, "project"));
  });

  it("reports wrapped: false and leaves a wrapped .mcp.json untouched", () => {
    claude();
    write(".mcp.json", { mcpServers: { a: server } });
    expect(normalizePlugin(dir, opts(), fake(1).run)).toMatchObject({ status: "split", servers: 1, wrapped: false });
    expect(read(".mcp.json")).toEqual({ mcpServers: { a: server } });
  });

  it("maps a root plugin.json to antigravity-plugin", () => {
    write("plugin.json", { name: "kit" });
    const { run } = fake(0);
    expect(normalizePlugin(dir, opts(), run).target).toBe("antigravity-plugin");
  });

  it("keeps a codex plugin native-only without running anything", () => {
    write(".codex-plugin/plugin.json", { name: "kit" });
    const { calls, run } = fake(0);
    expect(normalizePlugin(dir, opts(), run)).toEqual({ status: "native-only", reason: "no rulesync import target for .codex-plugin" });
    expect(calls).toEqual([]);
  });

  it("keeps a lossy plugin native-only and leaves the copy untouched", () => {
    claude();
    write("hooks/hooks.json", { modules: ["m"], hooks: {} });
    write(".mcp.json", { a: server });
    const { calls, run } = fake(1);
    expect(normalizePlugin(dir, opts(), run)).toEqual({
      status: "native-only",
      reason: "rulesync import would drop fields",
      lossy: [{ file: join("hooks", "hooks.json"), field: "modules", where: "modules" }],
    });
    expect(calls).toEqual([]);
    expect(read(".mcp.json")).toEqual({ a: server });
  });

  it("throws when the copy already has a .rulesync", () => {
    claude();
    mkdirSync(join(dir, ".rulesync"));
    const { calls, run } = fake(0);
    expect(() => normalizePlugin(dir, opts(), run)).toThrow(`${join(dir, ".rulesync")} already exists; normalize a freshly fetched copy`);
    expect(calls).toEqual([]);
  });

  it("throws when the import changes the MCP server count", () => {
    claude();
    write(".mcp.json", { a: server, b: server });
    expect(() => normalizePlugin(dir, opts(), fake(1).run)).toThrow("server count (2 → 1)");
  });

  it("fails loudly when the import writes no mcp.json for a plugin with servers", () => {
    claude();
    write(".mcp.json", { a: server });
    expect(() => normalizePlugin(dir, opts(), fake(null).run)).toThrow("server count (1 → 0)");
  });

  it("throws with the path when the imported mcp.json is invalid JSON", () => {
    claude();
    expect(() => normalizePlugin(dir, opts(), fake(0, "{ nope").run)).toThrow(join(dir, ".rulesync", "mcp.json"));
  });

  it("wraps a failing run with the copy and the cause", () => {
    claude();
    const boom = new Error("boom");
    let error;
    try {
      normalizePlugin(dir, opts(), () => { throw boom; });
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toBe(`rulesync import failed for ${dir} (boom)`);
    expect(error.cause).toBe(boom);
  });

  it("resolves the binary from projectDir, never from the copy", () => {
    claude();
    for (const root of [dir, join(dir, "project")]) {
      mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(root, "node_modules", ".bin", "rulesync"), "");
    }
    const { calls, run } = fake(0);
    normalizePlugin(dir, opts(), run);
    expect(calls[0].cmd).toBe(join(dir, "project", "node_modules", ".bin", "rulesync"));
  });

  it("never runs the npx fallback from the copy, which may ship its own bin", () => {
    claude();
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", ".bin", "rulesync"), "");
    const { calls, run } = fake(0);
    normalizePlugin(dir, opts(), run);
    expect(calls[0].cmd).toBe("npx");
    expect(calls[0].cwd).toBe(join(dir, "project"));
  });
});

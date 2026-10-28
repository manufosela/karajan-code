// ADR 0021, plan step 13b1: a plugin is normalized before `rulesync import`
// (flat .mcp.json wrapped) and its server count kept for the check after it;
// lossyFields reports what the import would drop.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countServers, lossyFields, prepareImport, wrapMcp } from "../src/plugin-normalize.js";

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

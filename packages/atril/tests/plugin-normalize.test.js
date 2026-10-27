// ADR 0021, plan step 13b1: a plugin is normalized before `rulesync import`
// (flat .mcp.json wrapped) and its server count kept for the check after it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countServers, prepareImport, wrapMcp } from "../src/plugin-normalize.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-normalize-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (rel, value) => writeFileSync(join(dir, rel), typeof value === "string" ? value : JSON.stringify(value));
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

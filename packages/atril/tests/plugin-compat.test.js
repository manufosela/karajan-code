// ADR 0021, decision 14 (step 13h): what each CLI could receive of a plugin, checked against its inventory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLI_MATRIX, compatReport, formatCompat } from "../src/plugin-compat.js";
import { pluginInventory } from "../src/plugin-trust.js";
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-compat-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const write = (rel, value = "") => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), typeof value === "string" ? value : JSON.stringify(value));
};
const hook = (command) => ({ matcher: "", hooks: [{ type: "command", command }] });
const fixture = () => {
  write(".claude-plugin/plugin.json", { name: "demo", version: "1.0.0" });
  write("skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\nbody");
  write("commands/c.md", "---\ndescription: d\n---\nbody");
  write("agents/a.md", "---\nname: a\ndescription: d\n---\nbody");
  write("hooks/hooks.json", { hooks: { PreToolUse: [hook("a")], SessionStart: [hook("b"), hook("c")], Stop: [hook("d")] } });
  write(".mcp.json", { mcpServers: { one: { command: "x" }, two: { url: "https://m" } } });
  write("bin/tool", "#!/bin/sh");
  write("package.json", { dependencies: { left: "1.x" } });
  write("package-lock.json", { lockfileVersion: 3 });
};
const part = (report, cli, name) => report.clis.find((entry) => entry.cli === cli).parts[name];
describe("compatReport", () => {
  it("covers claude, agy and opencode; every other CLI is unknown", () => {
    fixture();
    const report = compatReport(dir);
    expect(report.clis.map((entry) => entry.cli)).toEqual(["claude", "agy", "opencode"]);
    expect(report.unknown).toEqual(["codex", "cursor", "copilot"]);
  });
  it("counts, per CLI, what the inventory lists and what the CLI receives", () => {
    fixture();
    const inventory = pluginInventory(dir);
    const report = compatReport(dir);
    expect(inventory.hooks).toHaveLength(4);
    expect(part(report, "claude", "hooks")).toEqual({ total: 4, received: 4, status: "all" });
    expect(part(report, "agy", "hooks")).toEqual({ total: 4, received: 2, status: "partial" });
    expect(part(report, "opencode", "hooks")).toEqual({ total: 4, received: 0, status: "none" });
    for (const cli of ["claude", "agy", "opencode"]) expect(part(report, cli, "mcp")).toEqual({ total: inventory.mcpServers.length, received: 2, status: "all" });
    expect(part(report, "claude", "bin")).toEqual({ total: 1, received: 1, status: "all" });
    expect(part(report, "agy", "bin")).toEqual({ total: 1, received: 0, status: "none" });
    expect(part(report, "agy", "commands")).toEqual({ total: 1, received: 0, status: "none" });
    expect(part(report, "opencode", "commands")).toEqual({ total: 1, received: 1, status: "all" });
    expect(part(report, "opencode", "skills")).toEqual({ total: 1, received: 1, status: "all" });
    expect(part(report, "agy", "agents")).toEqual({ total: 1, received: 1, status: "all" });
    expect(part(report, "agy", "npm")).toEqual({ total: 1, received: 1, status: "all" });
    expect(part(report, "opencode", "npm")).toEqual({ total: 1, received: 0, status: "unknown" });
  });
  it("says every part is empty for a manifest-only plugin", () => {
    write(".claude-plugin/plugin.json", { name: "demo" });
    expect(part(compatReport(dir), "agy", "hooks")).toEqual({ total: 0, received: 0, status: "none" });
  });
});
describe("formatCompat", () => {
  it("prints one block per CLI and one line for the unknown ones", () => {
    fixture();
    const text = formatCompat(compatReport(dir));
    expect(text).toContain("plugin demo\n");
    expect(text).toContain("agy\n  skills 1/1 all\n  commands 0/1 none\n");
    expect(text).toContain("  hooks 2/4 partial\n");
    expect(text).toContain("unknown: codex, cursor, copilot\n");
    expect(text.endsWith("\n")).toBe(true);
  });
});

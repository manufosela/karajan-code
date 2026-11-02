// importCanonical: `rulesync import` runs on a throwaway copy in a throwaway directory; the runner is a fake.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importCanonical } from "../src/plugin-rulesync.js";

let dir, plugin, calls;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-rulesync-"));
  plugin = join(dir, "plugin");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "kit", version: "1.0.0", userConfig: { TOKEN: { title: "t", sensitive: true }, REGION: { title: "r" } } }));
  mkdirSync(join(dir, "project", ".rulesync"), { recursive: true });
  writeFileSync(join(dir, "project", ".rulesync", "mcp.json"), "{}\n");
  calls = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Like the import: .rulesync/mcp.json under --output-root.
const fake = (mcp, { fail } = {}) => (cmd, args, cwd) => {
  calls.push({ args, cwd });
  if (args.includes("--version")) return "1.0.0";
  if (fail) throw new Error("boom");
  const root = args[args.indexOf("--output-root") + 1];
  mkdirSync(join(root, ".rulesync"), { recursive: true });
  writeFileSync(join(root, ".rulesync", "mcp.json"), JSON.stringify(mcp));
};

describe("importCanonical", () => {
  it("reads the canonical result and leaves the project's .rulesync and the plugin untouched", () => {
    const before = readFileSync(join(dir, "project", ".rulesync", "mcp.json"), "utf8");
    const result = importCanonical(plugin, { projectDir: join(dir, "project") }, fake({ mcpServers: { db: { command: "npx" } } }));
    expect(result).toEqual({ status: "imported", canonical: { mcp: { mcpServers: { db: { command: "npx" } } } } });
    expect(readFileSync(join(dir, "project", ".rulesync", "mcp.json"), "utf8")).toBe(before);
    expect(existsSync(join(plugin, ".rulesync"))).toBe(false);
    expect(calls[1].args).toEqual(expect.arrayContaining(["import", "--targets", "claudecode-plugin", "--features", "mcp,hooks"]));
  });

  it("runs in a temporary directory that is removed, also when the import fails", () => {
    importCanonical(plugin, { projectDir: join(dir, "project") }, fake({ mcpServers: {} }));
    expect(calls[1].cwd.startsWith(tmpdir())).toBe(true);
    expect(existsSync(calls[1].cwd)).toBe(false);
    expect(() => importCanonical(plugin, { projectDir: join(dir, "project") }, fake({}, { fail: true }))).toThrow("rulesync import failed");
    expect(existsSync(calls[3].cwd)).toBe(false);
  });

  it("reports absent when rulesync does not answer", () => {
    const run = () => { throw new Error("not found"); };
    expect(importCanonical(plugin, { projectDir: join(dir, "project") }, run)).toEqual({ status: "absent" });
  });

  it("refers to a sensitive key as ${KEY} and leaves the others", () => {
    const mcp = { mcpServers: { db: { env: { A: "${user_config.TOKEN}", B: "${user_config.REGION}" } } } };
    const { canonical } = importCanonical(plugin, { projectDir: join(dir, "project") }, fake(mcp));
    expect(canonical.mcp.mcpServers.db.env).toEqual({ A: "${TOKEN}", B: "${user_config.REGION}" });
  });
});

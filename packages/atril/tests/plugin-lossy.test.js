// HU-3318: what a rulesync import loses decides whether the hooks and MCP entries are written or left to the host CLI.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notInstalledLines } from "../src/plugin-install-cli.js";
import { HARMLESS_LOSSY, RUN_CHANGING_LOSSY, splitLossy } from "../src/plugin-normalize.js";
import { importCanonical } from "../src/plugin-rulesync.js";

describe("splitLossy", () => {
  const lost = (field) => ({ file: "hooks/hooks.json", field, where: "hooks.Stop[0].hooks[0]" });

  it("treats a description-like field as harmless", () => {
    expect(splitLossy([lost("rewakeMessage")])).toEqual({ harmless: [lost("rewakeMessage")], blocking: [] });
  });

  it.each(["env", "cwd", "matcher", "timeout", "args", "modules", "hooks", "mcpServers"])("treats %s as changing what runs", (field) => {
    expect(splitLossy([lost(field)])).toEqual({ harmless: [], blocking: [lost(field)] });
  });

  it("treats an unknown field as changing what runs", () => {
    expect(splitLossy([lost("somethingNew")]).blocking).toEqual([lost("somethingNew")]);
  });

  it("keeps no field in both lists", () => {
    expect(HARMLESS_LOSSY.filter((field) => RUN_CHANGING_LOSSY.includes(field))).toEqual([]);
  });
});

describe("importCanonical with lost fields", () => {
  let dir, plugin;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atril-lossy-"));
    plugin = join(dir, "plugin");
    mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "kit", version: "1.0.0" }));
    mkdirSync(join(dir, "project"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const hooksFile = (extra) => {
    mkdirSync(join(plugin, "hooks"), { recursive: true });
    writeFileSync(join(plugin, "hooks", "hooks.json"), JSON.stringify({ ...extra, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi", ...extra?.hook }] }] } }));
  };
  const run = (cmd, args) => {
    if (args.includes("--version")) return "1.0.0";
    const out = join(args[args.indexOf("--output-root") + 1], ".rulesync");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "hooks.json"), JSON.stringify({ hooks: { Stop: [{ type: "command", command: "echo hi" }] } }));
  };
  const imported = () => importCanonical(plugin, { projectDir: join(dir, "project") }, run);

  it("writes the entry and names a harmless lost field", () => {
    hooksFile({ hook: { rewakeMessage: "wake" } });
    const result = imported();
    expect(result.canonical.hooks.hooks.Stop).toHaveLength(1);
    expect(result.lossy).toEqual([{ field: "rewakeMessage", where: "hooks.Stop[0].hooks[0]" }]);
    expect(result.skipped).toBeUndefined();
  });

  it("writes no entry when a lost field changes what runs, and says which", () => {
    hooksFile({ modules: ["x"] });
    const result = imported();
    expect(result.canonical).toEqual({});
    expect(result.lossy).toBeUndefined();
    expect(result.skipped).toEqual([{ kind: "plugin", name: "hooks and MCP servers", reason: "the import loses modules, which change when or how they run" }]);
  });

  it("adds nothing when the plugin loses no field", () => {
    hooksFile();
    const result = imported();
    expect(result).not.toHaveProperty("lossy");
    expect(result).not.toHaveProperty("skipped");
  });
});

describe("notInstalledLines with lost fields", () => {
  const base = { plugin: "kit", notInstalled: { hooks: [], mcpServers: [], bin: [] } };

  it("names each harmless lost field", () => {
    const lines = notInstalledLines({ ...base, rulesync: { status: "merged", lossy: [{ field: "rewakeMessage", where: "hooks.Stop[0].hooks[0]" }] } });
    expect(lines).toContain("atril: the import lost rewakeMessage (hooks.Stop[0].hooks[0]): the entry is written, the field does not change what runs");
  });

  it("names the field that blocks and prints the host CLI instructions, without claiming a write", () => {
    const skipped = [{ kind: "plugin", name: "hooks and MCP servers", reason: "the import loses modules, which change when or how they run" }];
    const lines = notInstalledLines({ ...base, rulesync: { status: "merged", skipped, instructions: ["claude: install \"kit\" with its own tool"] } });
    expect(lines.join("\n")).toContain("left out plugin \"hooks and MCP servers\": the import loses modules, which change when or how they run; install it with the host CLI, as below");
    expect(lines).toContain("atril: claude: install \"kit\" with its own tool");
    expect(lines.join("\n")).not.toContain("written to .rulesync/");
  });
});

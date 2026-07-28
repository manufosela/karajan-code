// KJC-TSK-0694 — AI-surface inventory: every new MCP an agent gains is one
// more access. An inventory that flags nothing is "the feeling of control
// without the control" (Akua) — so kj check flags what APPEARED since the
// last run. A nudge, never a gate.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkAiSurface, formatAiSurface } from "../../src/checks/ai-surface.js";

let dir, home, statePath;
const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-surface-prj-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-surface-home-"));
  statePath = path.join(home, ".karajan", "ai-surface.json");
  writeJson(path.join(dir, ".mcp.json"), { mcpServers: { "karajan-mcp": {}, sonarqube: {} } });
  writeJson(path.join(home, ".claude.json"), {
    mcpServers: { "planning-game": {} },
    projects: {
      [dir]: { mcpServers: { qmd: {} } },
      "/other/project": { mcpServers: { "unrelated-mcp": {} } },
    },
  });
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), '[mcp_servers.dev-hooks]\ncommand = "x"\n');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

const run = () => checkAiSurface({ projectDir: dir, home, statePath });

describe("checkAiSurface", () => {
  it("inventories MCPs across configs, scoping ~/.claude.json to this project", () => {
    const res = run();
    const names = res.surface.join(" ");
    expect(names).toContain("karajan-mcp");
    expect(names).toContain("sonarqube");
    expect(names).toContain("planning-game");
    expect(names).toContain("qmd");
    expect(names).toContain("dev-hooks");
    expect(names).not.toContain("unrelated-mcp");
  });

  it("first run records the baseline silently; second run is quiet if unchanged", () => {
    const first = run();
    expect(first.first).toBe(true);
    expect(first.added).toEqual([]);
    const second = run();
    expect(second.first).toBe(false);
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  it("flags an MCP that APPEARED since the last check, then absorbs it", () => {
    run();
    writeJson(path.join(dir, ".mcp.json"), { mcpServers: { "karajan-mcp": {}, sonarqube: {}, "shiny-new": {} } });
    const drifted = run();
    expect(drifted.added.join(" ")).toContain("shiny-new");
    expect(run().added).toEqual([]); // snapshot updated: flagged once, not forever
  });

  it("reports removals too (offboarding is part of hygiene)", () => {
    run();
    writeJson(path.join(dir, ".mcp.json"), { mcpServers: { "karajan-mcp": {} } });
    expect(run().removed.join(" ")).toContain("sonarqube");
  });
});

describe("formatAiSurface", () => {
  it("baseline, nudge and removal read as one line each", () => {
    expect(formatAiSurface({ surface: ["a", "b"], added: [], removed: [], first: true })).toMatch(/baseline/i);
    const nudge = formatAiSurface({ surface: ["a", "b", "c"], added: ["c (.mcp.json)"], removed: [], first: false });
    expect(nudge).toContain("NEW");
    expect(nudge).toMatch(/approved/i);
    expect(formatAiSurface({ surface: ["a"], added: [], removed: ["b (.mcp.json)"], first: false })).toContain("gone");
  });
});

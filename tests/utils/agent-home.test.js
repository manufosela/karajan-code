// KJC-TSK-1344: one person, two subscriptions per CLI (personal and Tribbu).
// claude keeps an account per CLAUDE_CONFIG_DIR and codex per CODEX_HOME;
// kj must look for each CLI's session and config where that variable points.
import { describe, it, expect } from "vitest";
import { agentAuthFiles, codexHome, claudeConfigFile, accountLabel } from "../../src/utils/agent-home.js";

const home = "/home/u";

describe("agent-home", () => {
  it("codex lives in CODEX_HOME, or ~/.codex without it", () => {
    expect(codexHome({ home, env: {} })).toBe("/home/u/.codex");
    expect(codexHome({ home, env: { CODEX_HOME: "/home/u/.codex-tribbu" } })).toBe("/home/u/.codex-tribbu");
    expect(agentAuthFiles("codex", { home, env: { CODEX_HOME: "/x" } })).toEqual(["/x/auth.json"]);
  });

  it("claude keeps .claude.json and .credentials.json in CLAUDE_CONFIG_DIR, or the home defaults", () => {
    expect(agentAuthFiles("claude", { home, env: {} })).toEqual(["/home/u/.claude.json", "/home/u/.claude"]);
    expect(agentAuthFiles("claude", { home, env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-tribbu" } }))
      .toEqual(["/home/u/.claude-tribbu/.claude.json", "/home/u/.claude-tribbu/.credentials.json"]);
    expect(claudeConfigFile({ home, env: { CLAUDE_CONFIG_DIR: "/c" } })).toBe("/c/.claude.json");
    expect(claudeConfigFile({ home, env: {} })).toBe("/home/u/.claude.json");
  });

  it("other agents keep their declared paths", () => {
    expect(agentAuthFiles("copilot", { home, env: {} })).toBeNull();
  });

  it("names the account directory only when the variable moves it", () => {
    expect(accountLabel("codex", { env: { CODEX_HOME: "/home/u/.codex-tribbu" } })).toBe("CODEX_HOME=/home/u/.codex-tribbu");
    expect(accountLabel("claude", { env: { CLAUDE_CONFIG_DIR: "/c" } })).toBe("CLAUDE_CONFIG_DIR=/c");
    expect(accountLabel("codex", { env: {} })).toBeNull();
    expect(accountLabel("copilot", { env: { CODEX_HOME: "/x" } })).toBeNull();
  });
});

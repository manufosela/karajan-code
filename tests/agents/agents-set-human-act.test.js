// HU-4894 (KJC-BUG-0660): the panel is the person's. `kj agents set` changes who codes, reviews
// and arbitrates, so it is a human act (ADR 0009, ADR 0018): refused to an agent session and
// confirmed at the person's terminal. The MCP `kj_agents` set refuses and names the command.
// Listing the panel stays free.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn(async () => ({ ok: false })),
  KNOWN_AGENTS: [{ name: "claude" }, { name: "codex" }, { name: "agy" }],
}));
vi.mock("../../src/session/runtime-overrides.js", () => ({
  setRuntimeOverride: vi.fn(),
  getRuntimeOverrides: vi.fn(() => ({})),
  clearRuntimeOverrides: vi.fn(),
}));
vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadGlobalConfigFile: vi.fn(async () => ({})),
    writeConfig: vi.fn(),
    getConfigPath: vi.fn(() => "/home/user/.karajan/kj.config.yml"),
    loadProjectConfig: vi.fn(async () => ({})),
    getProjectConfigPath: vi.fn(() => "/project/.karajan/kj.config.yml"),
    resolveRole: vi.fn(() => ({ provider: "claude", model: null })),
  };
});

const { setAgent, listAgents } = await import("../../src/commands/agents.js");
const { writeConfig } = await import("../../src/config.js");
const { setRuntimeOverride } = await import("../../src/session/runtime-overrides.js");
const { HUMAN_ACTS } = await import("../../src/harden/human-act.js");
const { handleAgents } = await import("../../src/mcp/handlers/management-handlers.js");

const human = { env: {}, tty: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) }, confirm: (nonce) => nonce };
const agentSession = { env: { CLAUDECODE: "1" }, tty: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) }, confirm: (nonce) => nonce };
const agentAncestor = { env: {}, tty: true, ancestry: { readProc: (p) => (p === 4242 ? { ppid: 1, cmd: "claude" } : { ppid: 4242, cmd: "node kj" }) }, confirm: (nonce) => nonce };

describe("kj agents set is a human act (HU-4894)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is in the catalog of human acts, implemented by src/commands/agents.js", () => {
    expect(HUMAN_ACTS["agents-set"]).toBeDefined();
    expect(HUMAN_ACTS["agents-set"].module).toBe("src/commands/agents.js");
    expect(HUMAN_ACTS["agents-set"].label).toMatch(/kj agents set/);
  });

  it("an agent session is refused, and neither the config nor the session override changes", async () => {
    await expect(setAgent("reviewer", "claude", { deps: agentSession })).rejects.toThrow(/kj agents set.*acto humano/);
    expect(writeConfig).not.toHaveBeenCalled();
    expect(setRuntimeOverride).not.toHaveBeenCalled();
  });

  it("a process that descends from an agent is refused, with --global too", async () => {
    await expect(setAgent("reviewer", "claude", { global: true, deps: agentAncestor })).rejects.toThrow(/acto humano/);
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it("an answer that is not the code shown at the terminal is refused", async () => {
    await expect(setAgent("reviewer", "codex", { deps: { ...human, confirm: () => "wrong" } })).rejects.toThrow();
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it("the person at their terminal sets the provider", async () => {
    const res = await setAgent("reviewer", "codex", { deps: human });
    expect(res).toMatchObject({ role: "reviewer", provider: "codex", scope: "project" });
    expect(writeConfig).toHaveBeenCalledTimes(1);
  });

  it("the MCP kj_agents set refuses, names the command for the person, and writes nothing", async () => {
    const res = await handleAgents({ action: "set", role: "reviewer", provider: "claude" });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toMatch(/kj agents set/);
    expect(writeConfig).not.toHaveBeenCalled();
    expect(setRuntimeOverride).not.toHaveBeenCalled();
  });

  it("listing the panel stays free", () => {
    expect(listAgents({}, {}, null).map((a) => a.role)).toContain("reviewer");
  });
});

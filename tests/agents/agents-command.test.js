import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn(async () => ({ ok: false })),
  KNOWN_AGENTS: [
    { name: "claude", install: "npm i -g @anthropic-ai/claude-code" },
    { name: "codex", install: "npm i -g @openai/codex" },
    { name: "gemini", install: "npm i -g @anthropic-ai/gemini" },
    { name: "aider", install: "pip install aider-chat" }
  ]
}));

// Post-v2.7.5 agents.js imports from src/session/runtime-overrides.js
// (layer-neutral), not from src/mcp/preflight.js (layer violation).
vi.mock("../../src/session/runtime-overrides.js", () => ({
  setRuntimeOverride: vi.fn(),
  getRuntimeOverrides: vi.fn(() => ({})),
  clearRuntimeOverrides: vi.fn()
}));

// loadProjectConfig / getProjectConfigPath are now called by the session
// fallback path — mock them here so the test doesn't hit the real fs.
vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadConfig: vi.fn(),
    writeConfig: vi.fn(),
    getConfigPath: vi.fn(() => "/home/user/.karajan/kj.config.yml"),
    loadProjectConfig: vi.fn(() => null),
    getProjectConfigPath: vi.fn(() => "/project/.karajan/kj.config.yml"),
    resolveRole: vi.fn((config, role) => {
      const roles = config?.roles || {};
      return {
        provider: roles[role]?.provider || "claude",
        model: roles[role]?.model || null
      };
    })
  };
});

const { listAgents, setAgent } = await import("../../src/commands/agents.js");
const { loadConfig, writeConfig } = await import("../../src/config.js");
const { setRuntimeOverride } = await import("../../src/session/runtime-overrides.js");

describe("agents command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listAgents", () => {
    it("lists all assignable roles with their providers", () => {
      const config = {
        roles: {
          coder: { provider: "claude", model: "opus" },
          reviewer: { provider: "codex", model: null }
        }
      };
      const agents = listAgents(config);

      expect(agents.length).toBe(9);
      expect(agents.find((a) => a.role === "coder").provider).toBe("claude");
      expect(agents.find((a) => a.role === "reviewer").provider).toBe("codex");
    });

    it("shows - for roles without explicit provider", () => {
      const config = { roles: {} };
      // resolveRole mock returns "claude" by default
      const agents = listAgents(config);
      expect(agents.every((a) => a.provider)).toBe(true);
    });
  });

  describe("setAgent", () => {
    it("updates role provider in config and writes to disk with global=true", async () => {
      loadConfig.mockResolvedValue({
        config: { roles: { coder: { provider: "claude" } } }
      });
      writeConfig.mockResolvedValue(undefined);

      const result = await setAgent("coder", "gemini", { global: true });

      expect(result.role).toBe("coder");
      expect(result.provider).toBe("gemini");
      expect(result.scope).toBe("global");
      expect(writeConfig).toHaveBeenCalledWith(
        "/home/user/.karajan/kj.config.yml",
        expect.objectContaining({
          roles: expect.objectContaining({
            coder: expect.objectContaining({ provider: "gemini" })
          })
        })
      );
    });

    it("writes to project config + runtime-override when global=false (default)", async () => {
      // Post-v2.7.5: the CLI no longer stops at "session only" (an
      // in-memory state a CLI process loses on exit, useless). It now
      // both updates the runtime-override store (for any MCP server in
      // the same process) AND mirrors to .karajan/kj.config.yml so the
      // next CLI invocation picks it up.
      writeConfig.mockResolvedValue(undefined);
      const result = await setAgent("coder", "gemini");

      expect(result.role).toBe("coder");
      expect(result.provider).toBe("gemini");
      expect(result.scope).toBe("project");
      expect(result.configPath).toBe("/project/.karajan/kj.config.yml");
      expect(setRuntimeOverride).toHaveBeenCalledWith("coder", "gemini");
      expect(writeConfig).toHaveBeenCalledWith(
        "/project/.karajan/kj.config.yml",
        expect.objectContaining({
          roles: expect.objectContaining({
            coder: expect.objectContaining({ provider: "gemini" })
          })
        })
      );
    });

    it("falls back to session scope when project config is not writable", async () => {
      writeConfig.mockRejectedValueOnce(new Error("EACCES"));
      const result = await setAgent("coder", "gemini");
      expect(result.scope).toBe("session");
      expect(setRuntimeOverride).toHaveBeenCalledWith("coder", "gemini");
    });

    it("throws for unknown role", async () => {
      await expect(setAgent("unknown", "claude")).rejects.toThrow("Unknown role");
    });

    it("throws for unknown provider not found as binary", async () => {
      await expect(setAgent("coder", "nonexistent")).rejects.toThrow("not found");
    });

    it("creates role entry if it does not exist with global=true", async () => {
      loadConfig.mockResolvedValue({
        config: { roles: {} }
      });
      writeConfig.mockResolvedValue(undefined);

      const result = await setAgent("planner", "codex", { global: true });

      expect(result.provider).toBe("codex");
      expect(result.scope).toBe("global");
      expect(writeConfig).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          roles: expect.objectContaining({
            planner: { provider: "codex" }
          })
        })
      );
    });
  });

  describe("listAgents with session overrides", () => {
    it("shows session override with scope=session", () => {
      const config = {
        roles: {
          coder: { provider: "claude", model: "opus" }
        }
      };
      const agents = listAgents(config, { coder: "gemini" });
      const coder = agents.find((a) => a.role === "coder");

      expect(coder.provider).toBe("gemini");
      expect(coder.scope).toBe("session");
    });

    it("shows scope=config when no session override exists", () => {
      const config = {
        roles: {
          coder: { provider: "claude", model: "opus" }
        }
      };
      const agents = listAgents(config);
      const coder = agents.find((a) => a.role === "coder");

      expect(coder.provider).toBe("claude");
      expect(coder.scope).toBe("global");
    });
  });
});

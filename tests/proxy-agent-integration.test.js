import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/local/bin/${name}`)
}));

vi.mock("../src/proxy/proxy-lifecycle.js", () => ({
  getProxyEnv: vi.fn(),
  getProxyStats: vi.fn(() => null)
}));

const PROXY_ENV = {
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9999",
  OPENAI_BASE_URL: "http://127.0.0.1:9999",
  GEMINI_API_BASE: "http://127.0.0.1:9999",
};

const baseConfig = {
  roles: { coder: {}, reviewer: {} },
  coder_options: {},
  reviewer_options: {}
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("Proxy-agent integration", () => {
  let runCommand;
  let getProxyEnv;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../src/utils/process.js");
    runCommand = proc.runCommand;
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "output", stderr: "" });

    const proxy = await import("../src/proxy/proxy-lifecycle.js");
    getProxyEnv = proxy.getProxyEnv;
  });

  describe("ClaudeAgent", () => {
    it("does NOT inject proxy env (Claude CLI does not respect ANTHROPIC_BASE_URL)", async () => {
      getProxyEnv.mockReturnValue(PROXY_ENV);
      const { ClaudeAgent } = await import("../src/agents/claude-agent.js");
      const agent = new ClaudeAgent("claude", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      // Proxy env vars should NOT be injected for Claude
      expect(opts.env).not.toHaveProperty("ANTHROPIC_BASE_URL");
      expect(opts.env).not.toHaveProperty("OPENAI_BASE_URL");
      // CLAUDECODE should still be stripped
      expect(opts.env).not.toHaveProperty("CLAUDECODE");
      expect(opts.stdin).toBe("ignore");
    });
  });

  describe("CodexAgent", () => {
    it("injects proxy env vars when proxy is running", async () => {
      getProxyEnv.mockReturnValue(PROXY_ENV);
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9999");
      expect(opts.env.OPENAI_BASE_URL).toBe("http://127.0.0.1:9999");
      expect(opts.env.GEMINI_API_BASE).toBe("http://127.0.0.1:9999");
    });

    it("does not set env when proxy is not running", async () => {
      getProxyEnv.mockReturnValue(null);
      const { CodexAgent } = await import("../src/agents/codex-agent.js");
      const agent = new CodexAgent("codex", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts).not.toHaveProperty("env");
    });
  });

  describe("GeminiAgent", () => {
    it("injects proxy env vars when proxy is running", async () => {
      getProxyEnv.mockReturnValue(PROXY_ENV);
      const { GeminiAgent } = await import("../src/agents/gemini-agent.js");
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9999");
      expect(opts.env.OPENAI_BASE_URL).toBe("http://127.0.0.1:9999");
      expect(opts.env.GEMINI_API_BASE).toBe("http://127.0.0.1:9999");
    });

    it("does not set env when proxy is not running", async () => {
      getProxyEnv.mockReturnValue(null);
      const { GeminiAgent } = await import("../src/agents/gemini-agent.js");
      const agent = new GeminiAgent("gemini", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts).not.toHaveProperty("env");
    });
  });

  describe("AiderAgent", () => {
    it("injects proxy env vars and --api-base flag when proxy is running", async () => {
      getProxyEnv.mockReturnValue(PROXY_ENV);
      const { AiderAgent } = await import("../src/agents/aider-agent.js");
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9999");
      expect(opts.env.OPENAI_BASE_URL).toBe("http://127.0.0.1:9999");

      const args = runCommand.mock.calls[0][1];
      expect(args).toContain("--api-base");
      expect(args).toContain("http://127.0.0.1:9999");
    });

    it("does not set env or --api-base when proxy is not running", async () => {
      getProxyEnv.mockReturnValue(null);
      const { AiderAgent } = await import("../src/agents/aider-agent.js");
      const agent = new AiderAgent("aider", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts).not.toHaveProperty("env");

      const args = runCommand.mock.calls[0][1];
      expect(args).not.toContain("--api-base");
    });
  });

  describe("OpenCodeAgent", () => {
    it("injects proxy env vars when proxy is running", async () => {
      getProxyEnv.mockReturnValue(PROXY_ENV);
      const { OpenCodeAgent } = await import("../src/agents/opencode-agent.js");
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9999");
      expect(opts.env.OPENAI_BASE_URL).toBe("http://127.0.0.1:9999");
      expect(opts.env.GEMINI_API_BASE).toBe("http://127.0.0.1:9999");
    });

    it("does not set env when proxy is not running", async () => {
      getProxyEnv.mockReturnValue(null);
      const { OpenCodeAgent } = await import("../src/agents/opencode-agent.js");
      const agent = new OpenCodeAgent("opencode", baseConfig, logger);
      await agent.runTask({ prompt: "fix bug", role: "coder" });

      const opts = runCommand.mock.calls[0][2];
      expect(opts).not.toHaveProperty("env");
    });
  });
});

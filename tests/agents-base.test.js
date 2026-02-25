import { describe, expect, it, vi } from "vitest";
import { BaseAgent } from "../src/agents/base-agent.js";

describe("BaseAgent", () => {
  const config = {
    roles: {
      coder: { provider: "codex", model: "gpt-4o" },
      reviewer: { provider: "claude", model: "sonnet" }
    },
    coder_options: { auto_approve: true, model: "fallback-coder-model" },
    reviewer_options: { model: "fallback-reviewer-model" }
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  it("stores name, config, and logger", () => {
    const agent = new BaseAgent("test", config, logger);
    expect(agent.name).toBe("test");
    expect(agent.config).toBe(config);
    expect(agent.logger).toBe(logger);
  });

  it("runTask throws not implemented", async () => {
    const agent = new BaseAgent("test", config, logger);
    await expect(agent.runTask({})).rejects.toThrow("not implemented");
  });

  it("reviewTask throws not implemented", async () => {
    const agent = new BaseAgent("test", config, logger);
    await expect(agent.reviewTask({})).rejects.toThrow("not implemented");
  });

  describe("getRoleModel", () => {
    it("returns role-specific model from config.roles", () => {
      const agent = new BaseAgent("test", config, logger);
      expect(agent.getRoleModel("coder")).toBe("gpt-4o");
      expect(agent.getRoleModel("reviewer")).toBe("sonnet");
    });

    it("falls back to reviewer_options.model for reviewer role", () => {
      const agent = new BaseAgent("test", { ...config, roles: {} }, logger);
      expect(agent.getRoleModel("reviewer")).toBe("fallback-reviewer-model");
    });

    it("falls back to coder_options.model for coder role", () => {
      const agent = new BaseAgent("test", { ...config, roles: {} }, logger);
      expect(agent.getRoleModel("coder")).toBe("fallback-coder-model");
    });

    it("returns null when no model configured", () => {
      const agent = new BaseAgent("test", {}, logger);
      expect(agent.getRoleModel("coder")).toBeNull();
    });
  });

  describe("isAutoApproveEnabled", () => {
    it("returns true for coder when auto_approve is set", () => {
      const agent = new BaseAgent("test", config, logger);
      expect(agent.isAutoApproveEnabled("coder")).toBe(true);
    });

    it("always returns false for reviewer role", () => {
      const agent = new BaseAgent("test", config, logger);
      expect(agent.isAutoApproveEnabled("reviewer")).toBe(false);
    });

    it("returns false when auto_approve is not set", () => {
      const agent = new BaseAgent("test", { coder_options: {} }, logger);
      expect(agent.isAutoApproveEnabled("coder")).toBe(false);
    });
  });
});

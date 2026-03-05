import { describe, expect, it } from "vitest";
import { getAvailableAgents, createAgent } from "../src/agents/index.js";
import { BaseAgent } from "../src/agents/base-agent.js";

const config = {
  session: { max_iteration_minutes: 5 },
  coder_options: { auto_approve: true },
};
const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe("agent contract tests", () => {
  const agents = getAvailableAgents();

  it("has at least 5 registered agents", () => {
    expect(agents.length).toBeGreaterThanOrEqual(5);
  });

  describe.each(agents.map((a) => [a.name]))("%s", (name) => {
    it("creates an instance via createAgent()", () => {
      const agent = createAgent(name, config, logger);
      expect(agent).toBeDefined();
    });

    it("extends BaseAgent", () => {
      const agent = createAgent(name, config, logger);
      expect(agent).toBeInstanceOf(BaseAgent);
    });

    it("has runTask method", () => {
      const agent = createAgent(name, config, logger);
      expect(typeof agent.runTask).toBe("function");
    });

    it("has reviewTask method", () => {
      const agent = createAgent(name, config, logger);
      expect(typeof agent.reviewTask).toBe("function");
    });

    it("has getRoleModel method", () => {
      const agent = createAgent(name, config, logger);
      expect(typeof agent.getRoleModel).toBe("function");
    });

    it("has isAutoApproveEnabled method", () => {
      const agent = createAgent(name, config, logger);
      expect(typeof agent.isAutoApproveEnabled).toBe("function");
    });

    it("stores name, config, and logger", () => {
      const agent = createAgent(name, config, logger);
      expect(agent.name).toBe(name);
      expect(agent.config).toBe(config);
      expect(agent.logger).toBe(logger);
    });
  });
});

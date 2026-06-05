// kept-because: external-contract
//
// Boundary test for `src/agents/index.js` — the public agent factory called
// by the CLI, MCP server, and downstream stages. This is the documented
// contract surface for external callers (every command wiring uses
// `createAgent(name, config, logger, env?)` to instantiate a provider).
//
// Per the diet pass on `tests/integration/*`, integration tests that
// duplicate a unit-tested code path collapse to a single boundary test.
// The unit-level tests live in `tests/agents-index.test.js` and
// `tests/agents/create-agent.test.js`. This file keeps the contract
// pinned at the integration layer because it's an external API: deleting
// it would let a refactor break the public surface without any test
// turning red, even though every internal unit test still passes.
//
// regression-for: TSK-external-contract
import { describe, expect, it, vi } from "vitest";
import {
  createAgent,
  registerAgent,
  getAvailableAgents,
  getAgentMeta
} from "../../src/agents/index.js";
import { BaseAgent } from "../../src/agents/base-agent.js";
import { createNoopLogger } from "../_fixtures/loggers.js";

const config = { roles: {}, coder_options: {}, reviewer_options: {} };
const logger = createNoopLogger();

describe("integration: src/agents/index.js external contract", () => {
  it("exposes the documented public functions", () => {
    expect(typeof createAgent).toBe("function");
    expect(typeof registerAgent).toBe("function");
    expect(typeof getAvailableAgents).toBe("function");
    expect(typeof getAgentMeta).toBe("function");
  });

  it("createAgent returns a BaseAgent subclass for every built-in provider", () => {
    for (const name of ["claude", "codex", "gemini", "aider", "opencode"]) {
      const agent = createAgent(name, config, logger);
      expect(agent).toBeInstanceOf(BaseAgent);
      expect(agent.name).toBe(name);
    }
  });

  it("createAgent throws a recognisable error for unknown providers", () => {
    expect(() => createAgent("definitely-not-a-real-provider", config, logger))
      .toThrow(/Unsupported agent/);
  });
});

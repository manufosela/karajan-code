import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/agent-detect.js", () => ({
  detectAvailableAgents: vi.fn()
}));

import { detectAvailableAgents } from "../src/utils/agent-detect.js";
const { autoAssignRoles, applyRoleAssignments, CAPABILITY_TIERS } = await import("../src/utils/role-assigner.js");

describe("role-assigner", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("autoAssignRoles", () => {
    it("assigns all roles to single available agent", async () => {
      detectAvailableAgents.mockResolvedValue([
        { name: "claude", available: true, version: "2.1.91" },
        { name: "codex", available: false, version: null },
        { name: "gemini", available: false, version: null }
      ]);

      const { assignments } = await autoAssignRoles();
      expect(assignments.brain).toBe("claude");
      expect(assignments.coder).toBe("claude");
      expect(assignments.reviewer).toBe("claude");
      expect(assignments.solomon).toBe("claude");
    });

    it("diversifies reviewer from coder when multiple agents available", async () => {
      detectAvailableAgents.mockResolvedValue([
        { name: "claude", available: true, version: "2.1.91" },
        { name: "codex", available: true, version: "0.1.0" },
        { name: "gemini", available: false, version: null }
      ]);

      const { assignments } = await autoAssignRoles();
      expect(assignments.coder).toBe("claude");
      expect(assignments.reviewer).toBe("codex");
      expect(assignments.brain).toBe("claude");
    });

    it("diversifies solomon from brain when possible", async () => {
      detectAvailableAgents.mockResolvedValue([
        { name: "claude", available: true, version: "2.1.91" },
        { name: "codex", available: true, version: "0.1.0" },
        { name: "gemini", available: true, version: "1.0" }
      ]);

      const { assignments } = await autoAssignRoles();
      expect(assignments.brain).toBe("claude");
      expect(assignments.solomon).not.toBe("claude");
    });

    it("returns default claude when no agents found", async () => {
      detectAvailableAgents.mockResolvedValue([
        { name: "claude", available: false },
        { name: "codex", available: false }
      ]);

      const logger = { warn: vi.fn(), info: vi.fn() };
      const { assignments } = await autoAssignRoles(logger);
      expect(assignments.coder).toBe("claude");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("No AI agents"));
    });
  });

  describe("applyRoleAssignments", () => {
    it("sets config roles and top-level aliases", () => {
      const config = { roles: {} };
      const assignments = {
        brain: "claude", solomon: "gemini", coder: "claude",
        reviewer: "codex", planner: "claude", researcher: "claude",
        architect: "claude", tester: "claude", security: "claude", triage: "claude"
      };

      const result = applyRoleAssignments(config, assignments);
      expect(result.coder).toBe("claude");
      expect(result.reviewer).toBe("codex");
      expect(result.roles.coder.provider).toBe("claude");
      expect(result.roles.reviewer.provider).toBe("codex");
      expect(result.roles.solomon.provider).toBe("gemini");
      expect(result.brain.provider).toBe("claude");
    });
  });

  describe("CAPABILITY_TIERS", () => {
    it("ranks claude highest", () => {
      expect(CAPABILITY_TIERS.claude).toBeGreaterThan(CAPABILITY_TIERS.codex);
      expect(CAPABILITY_TIERS.codex).toBeGreaterThan(CAPABILITY_TIERS.gemini);
    });
  });
});

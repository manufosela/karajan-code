import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  parseCardId,
  buildTaskFromCard,
  buildCommitsPayload,
  buildCompletionUpdates
} from "../src/planning-game/adapter.js";

describe("planning-game/adapter", () => {
  describe("parseCardId", () => {
    it("extracts card ID from standard format", () => {
      expect(parseCardId("KJC-TSK-0042")).toBe("KJC-TSK-0042");
    });

    it("extracts card ID embedded in text", () => {
      expect(parseCardId("Implement KJC-TSK-0042 auth module")).toBe("KJC-TSK-0042");
    });

    it("extracts bug card ID", () => {
      expect(parseCardId("PLN-BUG-0015")).toBe("PLN-BUG-0015");
    });

    it("extracts epic card ID", () => {
      expect(parseCardId("EX2-PCS-0003")).toBe("EX2-PCS-0003");
    });

    it("returns null when no card ID found", () => {
      expect(parseCardId("Just a regular task description")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseCardId("")).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(parseCardId(undefined)).toBeNull();
    });

    it("returns first card ID when multiple present", () => {
      expect(parseCardId("KJC-TSK-0042 depends on KJC-TSK-0041")).toBe("KJC-TSK-0042");
    });
  });

  describe("buildTaskFromCard", () => {
    it("builds task string from card with structured description", () => {
      const card = {
        cardId: "KJC-TSK-0042",
        title: "Implement auth module",
        descriptionStructured: [
          { role: "Como desarrollador", goal: "Quiero un módulo de auth", benefit: "Para seguridad" }
        ],
        acceptanceCriteriaStructured: [
          { given: "Un usuario no autenticado", when: "Intenta acceder", then: "Se redirige a login" }
        ]
      };

      const task = buildTaskFromCard(card);
      expect(task).toContain("KJC-TSK-0042");
      expect(task).toContain("Implement auth module");
      expect(task).toContain("módulo de auth");
      expect(task).toContain("usuario no autenticado");
    });

    it("builds task string from card with plain description", () => {
      const card = {
        cardId: "KJC-TSK-0001",
        title: "Fix bug",
        description: "There is a null pointer in auth.js",
        acceptanceCriteria: "Auth should not crash"
      };

      const task = buildTaskFromCard(card);
      expect(task).toContain("Fix bug");
      expect(task).toContain("null pointer");
      expect(task).toContain("Auth should not crash");
    });

    it("includes implementation plan if present", () => {
      const card = {
        cardId: "KJC-TSK-0010",
        title: "Budget tracking",
        description: "Implement budget tracking",
        implementationPlan: {
          approach: "Use token counter middleware",
          steps: [
            { description: "Add counter module" },
            { description: "Integrate in orchestrator" }
          ]
        }
      };

      const task = buildTaskFromCard(card);
      expect(task).toContain("token counter middleware");
      expect(task).toContain("Add counter module");
    });

    it("handles minimal card with just title", () => {
      const card = {
        cardId: "KJC-TSK-0099",
        title: "Simple task"
      };

      const task = buildTaskFromCard(card);
      expect(task).toContain("KJC-TSK-0099");
      expect(task).toContain("Simple task");
    });
  });

  describe("buildCommitsPayload", () => {
    it("builds commits array from git log lines", () => {
      const gitLog = [
        { hash: "abc1234", message: "feat: add auth", date: "2026-02-26T10:00:00Z", author: "dev@test.com" },
        { hash: "def5678", message: "test: add auth tests", date: "2026-02-26T11:00:00Z", author: "dev@test.com" }
      ];

      const commits = buildCommitsPayload(gitLog);
      expect(commits).toHaveLength(2);
      expect(commits[0]).toEqual({
        hash: "abc1234",
        message: "feat: add auth",
        date: "2026-02-26T10:00:00Z",
        author: "dev@test.com"
      });
    });

    it("returns empty array for null input", () => {
      expect(buildCommitsPayload(null)).toEqual([]);
    });

    it("returns empty array for empty input", () => {
      expect(buildCommitsPayload([])).toEqual([]);
    });
  });

  describe("buildCompletionUpdates", () => {
    it("builds update payload for successful completion", () => {
      const updates = buildCompletionUpdates({
        approved: true,
        commits: [{ hash: "abc", message: "feat: done", date: "2026-02-26T12:00:00Z", author: "dev@test.com" }],
        startDate: "2026-02-26T10:00:00Z"
      });

      expect(updates.status).toBe("To Validate");
      expect(updates.endDate).toBeTruthy();
      expect(updates.commits).toHaveLength(1);
      expect(updates.developer).toBe("dev_016");
    });

    it("does not change status for failed runs", () => {
      const updates = buildCompletionUpdates({
        approved: false,
        commits: [],
        startDate: "2026-02-26T10:00:00Z"
      });

      expect(updates.status).toBeUndefined();
      expect(updates.endDate).toBeUndefined();
    });

    it("includes codeveloper when provided", () => {
      const updates = buildCompletionUpdates({
        approved: true,
        commits: [{ hash: "abc", message: "feat: done", date: "2026-02-26T12:00:00Z", author: "dev@test.com" }],
        startDate: "2026-02-26T10:00:00Z",
        codeveloper: "dev_001"
      });

      expect(updates.codeveloper).toBe("dev_001");
    });
  });
});

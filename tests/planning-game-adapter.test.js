import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  parseCardId,
  buildTaskFromCard,
  buildCommitsPayload,
  buildCompletionUpdates,
  buildTaskPrompt,
  updateCardOnCompletion
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

    it("extracts QA card ID", () => {
      expect(parseCardId("KJC-QA-0100")).toBe("KJC-QA-0100");
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

    it("builds prompt with multiple stories and mixed criteria", () => {
      const card = {
        cardId: "KJC-TSK-0043",
        title: "Planning-game tests",
        descriptionStructured: [
          { role: "QA", goal: "validar adapter", benefit: "evitar regresiones" },
          { role: "Dev", goal: "cubrir client", benefit: "mejorar robustez" }
        ],
        acceptanceCriteriaStructured: [
          { given: "API responde", when: "se solicita card", then: "retorna datos" },
          { raw: "Timeout se reporta claramente" }
        ]
      };

      const task = buildTaskFromCard(card);
      expect(task).toContain("### User Story");
      expect(task).toContain("- **Como** QA");
      expect(task).toContain("- **Como** Dev");
      expect(task).toContain("### Acceptance Criteria");
      expect(task).toContain("- **Given** API responde");
      expect(task).toContain("- Timeout se reporta claramente");
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

    it("updates status including mapped commits payload", () => {
      const commits = buildCommitsPayload([
        { hash: "abc123", message: "feat: add pg tests", date: "2026-02-26T10:00:00Z", author: "dev@test.com" }
      ]);

      const updates = buildCompletionUpdates({
        approved: true,
        commits,
        startDate: "2026-02-26T09:00:00Z"
      });

      expect(updates.status).toBe("To Validate");
      expect(updates.startDate).toBe("2026-02-26T09:00:00Z");
      expect(updates.commits).toEqual([
        { hash: "abc123", message: "feat: add pg tests", date: "2026-02-26T10:00:00Z", author: "dev@test.com" }
      ]);
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

  describe("buildTaskPrompt", () => {
    it("parses card ID from task text and builds prompt from card", () => {
      const result = buildTaskPrompt({
        task: "Please execute KJC-TSK-0043",
        card: {
          cardId: "KJC-TSK-0043",
          title: "Planning-game tests",
          descriptionStructured: [
            { role: "QA", goal: "validar adapter", benefit: "evitar regresiones" }
          ],
          acceptanceCriteriaStructured: [
            { given: "API responde", when: "se solicita card", then: "retorna datos" }
          ]
        }
      });

      expect(result.cardId).toBe("KJC-TSK-0043");
      expect(result.prompt).toContain("### User Story");
      expect(result.prompt).toContain("### Acceptance Criteria");
      expect(result.prompt).toContain("**Given** API responde");
    });

    it("falls back to raw task prompt when card is missing", () => {
      const result = buildTaskPrompt({
        task: "Do this task without PG card"
      });

      expect(result.cardId).toBeNull();
      expect(result.prompt).toBe("Do this task without PG card");
    });
  });

  describe("updateCardOnCompletion", () => {
    it("updates card status with mapped commits when approved", async () => {
      const client = {
        updateCard: vi.fn().mockResolvedValue({ ok: true })
      };

      await updateCardOnCompletion({
        client,
        projectId: "Karajan Code",
        cardId: "KJC-TSK-0043",
        firebaseId: "fb-1",
        approved: true,
        gitLog: [
          { hash: "abc123", message: "test: add pg tests", date: "2026-02-26T10:00:00Z", author: "dev@test.com" }
        ],
        startDate: "2026-02-26T09:00:00Z"
      });

      expect(client.updateCard).toHaveBeenCalledTimes(1);
      expect(client.updateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "Karajan Code",
          cardId: "KJC-TSK-0043",
          firebaseId: "fb-1",
          updates: expect.objectContaining({
            status: "To Validate",
            commits: [
              {
                hash: "abc123",
                message: "test: add pg tests",
                date: "2026-02-26T10:00:00Z",
                author: "dev@test.com"
              }
            ]
          })
        })
      );
    });

    it("skips update when completion is not approved", async () => {
      const client = {
        updateCard: vi.fn().mockResolvedValue({ ok: true })
      };

      await updateCardOnCompletion({
        client,
        projectId: "Karajan Code",
        cardId: "KJC-TSK-0043",
        firebaseId: "fb-1",
        approved: false,
        gitLog: []
      });

      expect(client.updateCard).not.toHaveBeenCalled();
    });
  });
});

import { describe, expect, it } from "vitest";

// KJC-TSK-1334: the runHuReviewerStage cases went with the retired pipeline (5.0).
const { buildHuStoriesFromPgCard } = await import("../../src/planning-game/pipeline-adapter.js");

describe("PG card feeds HU reviewer", () => {
  describe("buildHuStoriesFromPgCard", () => {
    it("converts PG card with descriptionStructured into HU stories", () => {
      const pgCard = {
        cardId: "KJC-TSK-0188",
        descriptionStructured: [
          { role: "a developer", goal: "feed PG data to hu-reviewer", benefit: "stories are pre-built from structured card data" }
        ],
        acceptanceCriteriaStructured: [
          { given: "a PG card with descriptionStructured", when: "hu-reviewer runs", then: "it uses PG data instead of auto-generating" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories).toHaveLength(1);
      expect(stories[0].id).toBe("KJC-TSK-0188");
      expect(stories[0].text).toContain("As a developer");
      expect(stories[0].text).toContain("feed PG data to hu-reviewer");
      expect(stories[0].text).toContain("stories are pre-built from structured card data");
      expect(stories[0].text).toContain("Acceptance Criteria:");
      expect(stories[0].text).toContain("Given a PG card with descriptionStructured");
      expect(stories[0].text).toContain("When hu-reviewer runs");
      expect(stories[0].text).toContain("Then it uses PG data instead of auto-generating");
    });

    it("returns null when PG card has no descriptionStructured", () => {
      const pgCard = {
        cardId: "KJC-TSK-0100",
        description: "Plain text description",
        title: "Some task"
      };

      const stories = buildHuStoriesFromPgCard(pgCard);
      expect(stories).toBeNull();
    });

    it("returns null for null or undefined card", () => {
      expect(buildHuStoriesFromPgCard(null)).toBeNull();
      expect(buildHuStoriesFromPgCard(undefined)).toBeNull();
    });

    it("includes plain acceptanceCriteria string when no structured AC", () => {
      const pgCard = {
        cardId: "KJC-TSK-0200",
        descriptionStructured: [
          { role: "a user", goal: "see the dashboard", benefit: "I can monitor metrics" }
        ],
        acceptanceCriteria: "- Dashboard loads within 2s\n- Shows 5 widgets"
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories).toHaveLength(1);
      expect(stories[0].text).toContain("Acceptance Criteria:");
      expect(stories[0].text).toContain("Dashboard loads within 2s");
    });

    it("handles multiple descriptionStructured entries", () => {
      const pgCard = {
        cardId: "KJC-TSK-0201",
        descriptionStructured: [
          { role: "an admin", goal: "manage users", benefit: "team stays organized" },
          { role: "a viewer", goal: "see reports", benefit: "I stay informed" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories).toHaveLength(1);
      expect(stories[0].text).toContain("As an admin");
      expect(stories[0].text).toContain("As a viewer");
    });

    it("handles acceptanceCriteriaStructured with raw entries", () => {
      const pgCard = {
        cardId: "KJC-TSK-0202",
        descriptionStructured: [
          { role: "a dev", goal: "run tests", benefit: "code quality stays high" }
        ],
        acceptanceCriteriaStructured: [
          { raw: "All tests must pass" },
          { given: "test suite", when: "run", then: "zero failures" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);
      expect(stories[0].text).toContain("- All tests must pass");
      expect(stories[0].text).toContain("Given test suite");
    });
  });

  describe("PG card acceptance criteria included in HU", () => {
    it("includes structured acceptance criteria (Given/When/Then) in story text", () => {
      const pgCard = {
        cardId: "KJC-TSK-0188",
        descriptionStructured: [
          { role: "a developer", goal: "integrate PG with hu-reviewer", benefit: "better story quality" }
        ],
        acceptanceCriteriaStructured: [
          { given: "a PG card with structured data", when: "the pipeline runs", then: "hu-reviewer receives PG stories" },
          { given: "a PG card without structured data", when: "the pipeline runs", then: "hu-reviewer falls back to task description" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories[0].text).toContain("Acceptance Criteria:");
      expect(stories[0].text).toContain("Given a PG card with structured data");
      expect(stories[0].text).toContain("When the pipeline runs");
      expect(stories[0].text).toContain("Then hu-reviewer receives PG stories");
      expect(stories[0].text).toContain("Given a PG card without structured data");
      expect(stories[0].text).toContain("Then hu-reviewer falls back to task description");
    });

    it("includes plain string acceptanceCriteria when no structured AC is available", () => {
      const pgCard = {
        cardId: "KJC-TSK-0300",
        descriptionStructured: [
          { role: "a QA", goal: "validate the feature", benefit: "bugs are caught early" }
        ],
        acceptanceCriteria: "All unit tests pass.\nNo regressions in existing functionality."
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories[0].text).toContain("Acceptance Criteria:");
      expect(stories[0].text).toContain("All unit tests pass.");
      expect(stories[0].text).toContain("No regressions in existing functionality.");
    });

    it("omits acceptance criteria section when neither structured nor plain AC exist", () => {
      const pgCard = {
        cardId: "KJC-TSK-0301",
        descriptionStructured: [
          { role: "a dev", goal: "do something", benefit: "it works" }
        ]
      };

      const stories = buildHuStoriesFromPgCard(pgCard);

      expect(stories[0].text).not.toContain("Acceptance Criteria:");
    });
  });
});

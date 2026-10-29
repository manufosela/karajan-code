// KJC-TSK-1257: characterization of Solomon's prompt before it is split into
// one function per section. The refactor must leave every prompt byte-identical.
import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/roles/solomon-role.js";

const cases = {
  empty: {},
  nullConflict: { conflict: null, task: "", instructions: "" },
  everything: {
    instructions: "custom instructions",
    task: "fix the login",
    conflict: {
      stage: "reviewer_rate_limit", iterationCount: 3, maxIterations: 5,
      isFirstRejection: true, isRepeat: false, budget_usd: 1.234,
      previousSolomonRulings: [
        { conflictStage: "reviewer", ruling: "approve_with_conditions", alternativeAgent: "codex" },
        { conflictStage: "tester", ruling: "escalate_human", error: "codex rate-limited" },
      ],
      history: [{ agent: "reviewer", feedback: 'Agent "claude" hit the rate limit' }, { message: "second" }, {}],
      issueCategories: { security: 1, style: 2 },
      blockingIssues: [{ severity: "high", description: "sql injection" }, "plain string issue", {}],
      symlinkTargets: [{ link: "a/link", target: "b/target" }],
      diff: "+ added line",
    },
  },
  rateLimitWithoutAgent: { conflict: { stage: "coder_rate_limit", history: [] } },
  zeroBudgetAndCounts: { conflict: { stage: "sonar", iterationCount: 0, maxIterations: 0, budget_usd: 0, blockingIssues: [], previousSolomonRulings: [], symlinkTargets: [] } },
  budgetNotANumber: { conflict: { stage: "tester", budget_usd: "3" } },
};

describe("Solomon buildPrompt characterization", () => {
  for (const [name, input] of Object.entries(cases)) {
    it(`renders the ${name} case exactly as before`, () => {
      expect(buildPrompt(input)).toMatchSnapshot();
    });
  }
});

import { describe, it, expect } from "vitest";
import { createBrainContext, isBrainEnabled, processRoleOutput, buildCoderFeedbackPrompt } from "../src/orchestrator/brain-coordinator.js";

describe("brain wiring integration", () => {
  it("reviewer output flows into feedback queue and becomes enriched coder prompt", () => {
    const brainCtx = createBrainContext({ enabled: true });

    const review = {
      approved: false,
      blocking_issues: [
        { id: "R-1", severity: "high", description: "CSRF protection missing on POST routes in server/api.js", file: "packages/server/api.js" },
        { id: "R-2", severity: "medium", description: "Missing test for auth middleware", file: "packages/server/auth.js" }
      ]
    };

    processRoleOutput(brainCtx, { roleName: "reviewer", output: review, iteration: 1 });

    expect(brainCtx.feedbackQueue.entries.length).toBe(2);
    const prompt = buildCoderFeedbackPrompt(brainCtx);
    expect(prompt).toBeTruthy();
    expect(prompt).toContain("CSRF");
    expect(prompt).toContain("auth middleware");
  });

  it("config with brain.enabled=true is recognized by isBrainEnabled", () => {
    expect(isBrainEnabled({ brain: { enabled: true } })).toBe(true);
    expect(isBrainEnabled({ pipeline: { brain: { enabled: true } } })).toBe(true);
    expect(isBrainEnabled({ brain: { enabled: false } })).toBe(false);
  });

  it("disabled brain context is a no-op", () => {
    const brainCtx = createBrainContext({ enabled: false });
    const review = { blocking_issues: [{ description: "x" }] };
    processRoleOutput(brainCtx, { roleName: "reviewer", output: review, iteration: 1 });
    expect(brainCtx.feedbackQueue.entries.length).toBe(0);
    expect(buildCoderFeedbackPrompt(brainCtx)).toBeNull();
  });
});

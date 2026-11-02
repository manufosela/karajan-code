// KJC-TSK-1379 (#3207): a finding that names no line is hard to apply and hard to
// arbitrate, so the reviewer names the file and line of each blocking issue.
import { describe, it, expect } from "vitest";
import { buildReviewerPrompt } from "../src/prompts/reviewer.js";

describe("reviewer prompt: where each finding is", () => {
  it("asks for the file and line of every blocking issue, null only for a whole-diff finding", async () => {
    const prompt = await buildReviewerPrompt({ task: "t", diff: "+x", reviewRules: "r", mode: "standard" });
    expect(prompt).toMatch(/"file":string\|null,"line":number\|null/);
    expect(prompt).toMatch(/names the file and the line[\s\S]*null only for a finding about the whole diff/);
  });
});

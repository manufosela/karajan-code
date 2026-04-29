import { describe, expect, it } from "vitest";
import { BaseAgent } from "../../src/agents/base-agent.js";

const agent = new BaseAgent("test", {}, null);

describe("BaseAgent.isModelNotSupportedError", () => {
  // merged-from: 7 for-loop-driven `it` calls + 2 stderr/output field tests
  // collapsed into a single positive-case it.each. Closures-in-loops were a
  // Sonar smell; the table form is the canonical vitest pattern.
  it.each([
    ["error",  "The 'o4-mini' model is not supported when using Codex with a ChatGPT account."],
    ["error",  "The 'o3' model is not supported when using Codex with a ChatGPT account."],
    ["error",  'Error: model "haiku" is not available for your account'],
    ["error",  "model does not exist: gpt-99"],
    ["error",  "unsupported model: o4-mini"],
    ["error",  "invalid model specified"],
    ["error",  "error: model_not_found"],
    ["stderr", "model is not supported"],
    ["output", "unsupported model"]
  ])("detects on %s field: %s", (field, msg) => {
    expect(agent.isModelNotSupportedError({ [field]: msg })).toBe(true);
  });

  // merged-from: 5 negative-pattern for-loop-driven its collapsed.
  it.each([
    "connection timeout",
    "rate limit exceeded",
    "command failed",
    "permission denied",
    ""
  ])("ignores: %j", (msg) => {
    expect(agent.isModelNotSupportedError({ error: msg })).toBe(false);
  });

  // merged-from: 3 null/undefined/empty-object guards collapsed (1 it, 3 asserts).
  it("handles null/undefined/empty result gracefully", () => {
    expect(agent.isModelNotSupportedError(null)).toBe(false);
    expect(agent.isModelNotSupportedError(undefined)).toBe(false);
    expect(agent.isModelNotSupportedError({})).toBe(false);
  });
});

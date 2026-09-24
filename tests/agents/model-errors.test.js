import { describe, expect, it } from "vitest";
import { isModelUnavailableText } from "../../src/agents/model-errors.js";

// KJC-TSK-0859: la tabla vivia en tests/agents/base-agent.test.js contra
// BaseAgent.isModelNotSupportedError. El metodo desaparecio al retirar el
// reintento privado de cada agente; la definicion (y sus casos) viven ahora
// donde el agente y el clasificador del brain la leen.
describe("isModelUnavailableText", () => {
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
  ])("detects: %s (%s)", (_field, msg) => {
    expect(isModelUnavailableText(msg)).toBe(true);
  });

  // merged-from: 5 negative-pattern for-loop-driven its collapsed.
  it.each([
    "connection timeout",
    "rate limit exceeded",
    "command failed",
    "permission denied",
    ""
  ])("ignores: %j", (msg) => {
    expect(isModelUnavailableText(msg)).toBe(false);
  });

  // merged-from: 3 null/undefined/empty-object guards collapsed (1 it, 3 asserts).
  it("handles null/undefined/empty text gracefully", () => {
    expect(isModelUnavailableText(null)).toBe(false);
    expect(isModelUnavailableText(undefined)).toBe(false);
    expect(isModelUnavailableText("")).toBe(false);
  });
});

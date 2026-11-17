// HU-4569 (#4569): opencode run --format json streams events; the verdict is in the text events.
import { describe, expect, it } from "vitest";
import { agentAnswerText, parseReviewVerdict } from "../../src/review/parser.js";

const line = (o) => JSON.stringify(o);
const verdict = '{"approved":true,"blocking_issues":[],"non_blocking_suggestions":[],"summary":"ok","confidence":0.9}';

describe("opencode's event stream", () => {
  it("reads the verdict from the text event of a single step", () => {
    const stream = [
      line({ type: "step_start", part: { type: "step-start" } }),
      line({ type: "text", part: { type: "text", text: verdict } }),
      line({ type: "step_finish", part: { type: "step-finish" } }),
    ].join("\n");
    expect(agentAnswerText(stream)).toBe(verdict);
    expect(parseReviewVerdict(stream)).toMatchObject({ approved: true, blocking_issues: [] });
  });

  it("reads the last step's text when an earlier step used tools, prose and a fenced block included", () => {
    const stream = [
      line({ type: "step_start" }),
      line({ type: "text", part: { text: "Let me look at the diff." } }),
      line({ type: "tool_use", part: { tool: "read" } }),
      line({ type: "step_finish" }),
      line({ type: "step_start" }),
      line({ type: "text", part: { text: "Here is my verdict:\n```json\n" } }),
      line({ type: "text", part: { text: `${verdict}\n\`\`\`` } }),
      line({ type: "step_finish" }),
    ].join("\n");
    expect(agentAnswerText(stream)).toMatch(/^Here is my verdict/);
    expect(parseReviewVerdict(stream)).toMatchObject({ approved: true });
  });

  it("leaves claude's result event and plain text as they were", () => {
    expect(agentAnswerText(line({ type: "result", result: verdict }))).toBe(verdict);
    expect(agentAnswerText("plain answer")).toBe("plain answer");
  });
});

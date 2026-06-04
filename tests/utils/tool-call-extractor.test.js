// KJC-TSK-0375 PR2 — Tests for the tool-call extractor.
import { describe, expect, it } from "vitest";
import { extractToolCalls } from "../../src/utils/tool-call-extractor.js";

const claudeLine = (content) => JSON.stringify({ type: "assistant", message: { content } });
const noise = [
  JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-4-7" }),
  JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }),
  JSON.stringify({ type: "result", result: "done" }),
  "non-json garbage line",
  "",
  "  ",
].join("\n");

describe("extractToolCalls", () => {
  it("returns [] for empty / non-string transcript or unknown provider", () => {
    expect(extractToolCalls({ transcript: "" })).toEqual([]);
    expect(extractToolCalls({ transcript: null })).toEqual([]);
    expect(extractToolCalls({})).toEqual([]);
    expect(extractToolCalls({ transcript: "x", provider: "wat" })).toEqual([]);
  });

  it("parses Claude stream-json tool_use blocks in order", () => {
    const transcript = [
      noise,
      claudeLine([
        { type: "text", text: "I will read the file." },
        { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.js" } },
      ]),
      claudeLine([
        { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
        { type: "tool_use", name: "Edit", input: { file_path: "/tmp/a.js", old: "x", new: "y" } },
      ]),
    ].join("\n");

    const calls = extractToolCalls({ transcript, provider: "claude" });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ tool: "Read", args: { file_path: "/tmp/a.js" } });
    expect(calls[1]).toEqual({ tool: "Bash", args: { command: "ls -la" } });
    expect(calls[2].tool).toBe("Edit");
    expect(calls[2].args.old).toBe("x");
  });

  it("ignores assistant blocks without content array, non-tool_use blocks, and bad inputs", () => {
    const transcript = [
      // Missing content array entirely.
      JSON.stringify({ type: "assistant", message: {} }),
      // content is not an array.
      JSON.stringify({ type: "assistant", message: { content: "string-not-array" } }),
      // tool_use block with no name → skipped.
      claudeLine([{ type: "tool_use", input: { x: 1 } }]),
      // text block alongside a real tool_use → only the tool_use comes out.
      claudeLine([
        { type: "text", text: "thinking…" },
        { type: "tool_use", name: "Glob", input: { pattern: "**/*.js" } },
      ]),
      // tool_use with non-object input → args defaults to {}.
      claudeLine([{ type: "tool_use", name: "Bash", input: null }]),
    ].join("\n");

    const calls = extractToolCalls({ transcript });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ tool: "Glob", args: { pattern: "**/*.js" } });
    expect(calls[1]).toEqual({ tool: "Bash", args: {} });
  });

  it("defaults provider to claude when omitted", () => {
    const transcript = claudeLine([{ type: "tool_use", name: "Read", input: { file_path: "x" } }]);
    expect(extractToolCalls({ transcript })).toEqual([{ tool: "Read", args: { file_path: "x" } }]);
  });
});

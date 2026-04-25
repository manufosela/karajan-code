import { describe, expect, it, vi } from "vitest";
import { translateStreamJsonEvent, createStreamJsonFilter } from "../src/agents/claude-agent.js";

// Pre-v2.7.5 the filter only recognised assistant/result and dumped
// everything else as raw JSON to the user — including the giant
// `system/init` line and every `rate_limit_event`. These tests pin
// the behaviour down so the noise can't come back.

describe("translateStreamJsonEvent", () => {
  it("condenses system/init into a one-line model announcement", () => {
    const out = translateStreamJsonEvent({
      type: "system",
      subtype: "init",
      model: "claude-opus-4-7",
      tools: ["a", "b"],
      session_id: "abc",
    });
    expect(out).toEqual({ line: "Claude session ready (model: claude-opus-4-7)", kind: "text" });
  });

  it("strips bracketed model suffixes (e.g. [1m])", () => {
    const out = translateStreamJsonEvent({ type: "system", subtype: "init", model: "claude-opus-4-7[1m]" });
    expect(out.line).toBe("Claude session ready (model: claude-opus-4-7)");
  });

  it("suppresses healthy rate_limit_event (status: allowed)", () => {
    expect(
      translateStreamJsonEvent({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })
    ).toBeNull();
  });

  it("surfaces actual rate-limit warnings", () => {
    const out = translateStreamJsonEvent({
      type: "rate_limit_event",
      rate_limit_info: { status: "throttled" },
    });
    expect(out).toEqual({ line: "Rate limit: throttled", kind: "text" });
  });

  it("suppresses 'user' echoes (tool_result feedback)", () => {
    expect(translateStreamJsonEvent({ type: "user", message: { content: [] } })).toBeNull();
  });

  it("returns multi-block for assistant payloads", () => {
    const out = translateStreamJsonEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }] },
    });
    expect(out._multi).toBe(true);
    expect(out.blocks).toHaveLength(1);
  });

  it("renders result as a one-liner", () => {
    const out = translateStreamJsonEvent({ type: "result", result: "everything is fine\nmore lines" });
    expect(out).toEqual({ line: "done: everything is fine" });
  });

  it("drops unknown event types silently when DEBUG_KJ_AGENT is unset", () => {
    delete process.env.DEBUG_KJ_AGENT;
    expect(translateStreamJsonEvent({ type: "some_future_event", foo: 1 })).toBeNull();
  });
});

describe("createStreamJsonFilter", () => {
  it("forwards nothing for system/init's noise (just the friendly line)", () => {
    const sink = vi.fn();
    const filter = createStreamJsonFilter(sink);
    filter({
      stream: "stdout",
      line: JSON.stringify({
        type: "system",
        subtype: "init",
        model: "claude-opus-4-7",
        tools: Array.from({ length: 200 }, (_, i) => `tool_${i}`),
        mcp_servers: Array.from({ length: 50 }, (_, i) => ({ name: `s${i}`, status: "connected" })),
      }),
    });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].line).toMatch(/Claude session ready/);
    // Critically: the giant raw JSON must not appear anywhere.
    const allLines = sink.mock.calls.map((c) => c[0].line).join("\n");
    expect(allLines).not.toContain("mcp_servers");
    expect(allLines).not.toContain('"type":"system"');
  });

  it("emits one onOutput per assistant content block", () => {
    const sink = vi.fn();
    const filter = createStreamJsonFilter(sink);
    filter({
      stream: "stdout",
      line: JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Reading SPEC.md\nthen analyzing" },
            { type: "tool_use", name: "Read", input: { file_path: "/x/SPEC.md" } },
          ],
        },
      }),
    });
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0][0].kind).toBe("text");
    expect(sink.mock.calls[0][0].line).toBe("Reading SPEC.md");   // first line only
    expect(sink.mock.calls[1][0].kind).toBe("tool");
  });

  it("drops malformed JSON-shaped lines instead of echoing them", () => {
    const sink = vi.fn();
    const filter = createStreamJsonFilter(sink);
    filter({ stream: "stdout", line: '{"truncated":true,"incom' });
    expect(sink).not.toHaveBeenCalled();
  });

  it("forwards short non-JSON diagnostic lines (e.g. stderr leaks)", () => {
    const sink = vi.fn();
    const filter = createStreamJsonFilter(sink);
    filter({ stream: "stderr", line: "warning: deprecated --foo flag" });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].line).toBe("warning: deprecated --foo flag");
  });

  it("returns null when onOutput is null (no-op)", () => {
    expect(createStreamJsonFilter(null)).toBeNull();
  });
});

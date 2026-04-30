import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createCliProgressReporter } from "../../src/utils/cli-progress.js";

// Minimal Writable-like mock so we can assert what hits stderr.
function makeStream() {
  const chunks = [];
  return {
    chunks,
    write: (s) => { chunks.push(s); return true; },
    text: () => chunks.join(""),
  };
}

describe("createCliProgressReporter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("emits a starting header and a footer with elapsed time", () => {
    const stream = makeStream();
    const r = createCliProgressReporter({ role: "planner", stream, heartbeatMs: 0 });
    r.finish();
    const out = stream.text();
    expect(out).toMatch(/^\[planner\] starting\.\.\./);
    expect(out).toMatch(/\[planner\] done \(\d+\.\ds\)\n$/);
  });

  it("renders one line per onOutput with the kind-appropriate icon", () => {
    const stream = makeStream();
    const r = createCliProgressReporter({ role: "planner", stream, heartbeatMs: 0 });
    r.onOutput({ line: "Read SPEC.md", kind: "tool" });
    r.onOutput({ line: "Analyzing", kind: "text" });
    r.onOutput({ line: "thinking: deciding…", kind: "thinking" });
    r.finish();
    expect(stream.text()).toMatch(/▸ Read SPEC\.md/);
    expect(stream.text()).toMatch(/· Analyzing/);
    expect(stream.text()).toMatch(/… thinking: deciding…/);
  });

  it("ignores empty / non-string lines instead of printing blank rows", () => {
    const stream = makeStream();
    const r = createCliProgressReporter({ role: "p", stream, heartbeatMs: 0 });
    r.onOutput({ line: "" });
    r.onOutput({ line: null });
    r.onOutput({});
    r.onOutput({ line: "  \n  " });
    r.finish();
    // Header + footer only — nothing else.
    const lines = stream.text().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("quiet mode is a total no-op (used by --json)", () => {
    const stream = makeStream();
    const r = createCliProgressReporter({ role: "p", stream, quiet: true });
    r.onOutput({ line: "anything" });
    r.finish();
    expect(stream.text()).toBe("");
  });

  describe("idle heartbeat", () => {
    it("prints a 'still working' line after heartbeatMs of silence", () => {
      const stream = makeStream();
      const r = createCliProgressReporter({ role: "p", stream, heartbeatMs: 1000 });
      vi.advanceTimersByTime(1100);
      const out = stream.text();
      // braille icon + a non-empty line + parenthesised seconds elapsed
      expect(out).toMatch(/⠿ .+ \(\d+s\)/);
      r.finish();
    });

    it("real onOutput resets the idle clock so chatter does not double up", () => {
      const stream = makeStream();
      const r = createCliProgressReporter({ role: "p", stream, heartbeatMs: 1000 });
      vi.advanceTimersByTime(900);
      r.onOutput({ line: "real activity", kind: "tool" });
      vi.advanceTimersByTime(900);
      // Total elapsed: 1.8s, but the activity at 900ms reset the
      // counter, so silence is only 900ms — under the 1000ms threshold.
      expect(stream.text()).not.toMatch(/⠿/);
      r.finish();
    });

    it("varies the heartbeat phrase between consecutive ticks", () => {
      const stream = makeStream();
      const r = createCliProgressReporter({ role: "p", stream, heartbeatMs: 100 });
      // Force several ticks back-to-back.
      vi.advanceTimersByTime(150);
      vi.advanceTimersByTime(150);
      vi.advanceTimersByTime(150);
      const lines = stream.text().split("\n").filter((l) => l.includes("⠿"));
      expect(lines.length).toBeGreaterThanOrEqual(2);
      // Strip the elapsed-seconds suffix and assert no two adjacent
      // messages are identical.
      const messages = lines.map((l) => l.replace(/\s*\(\d+s\)\s*$/, ""));
      for (let i = 1; i < messages.length; i += 1) {
        expect(messages[i]).not.toBe(messages[i - 1]);
      }
      r.finish();
    });

    it("finish() clears the heartbeat timer", () => {
      const stream = makeStream();
      const r = createCliProgressReporter({ role: "p", stream, heartbeatMs: 100 });
      r.finish();
      vi.advanceTimersByTime(500);
      // No ⠿ heartbeat line should appear after finish.
      expect(stream.text()).not.toMatch(/⠿/);
    });
  });
});

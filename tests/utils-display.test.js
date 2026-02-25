import { describe, expect, it, vi, beforeEach } from "vitest";
import { formatElapsed, printHeader, printEvent } from "../src/utils/display.js";

describe("utils/display", () => {
  describe("formatElapsed", () => {
    it("formats 0ms as 00:00", () => {
      expect(formatElapsed(0)).toBe("00:00");
    });

    it("formats undefined as 00:00", () => {
      expect(formatElapsed(undefined)).toBe("00:00");
    });

    it("formats 90 seconds as 01:30", () => {
      expect(formatElapsed(90000)).toBe("01:30");
    });

    it("formats 5 seconds as 00:05", () => {
      expect(formatElapsed(5000)).toBe("00:05");
    });

    it("formats 600 seconds as 10:00", () => {
      expect(formatElapsed(600000)).toBe("10:00");
    });

    it("pads single digit minutes and seconds", () => {
      expect(formatElapsed(65000)).toBe("01:05");
    });
  });

  describe("printHeader", () => {
    let spy;

    beforeEach(() => {
      spy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("prints task, coder, reviewer, max iterations and timeout", () => {
      printHeader({
        task: "Fix auth bug",
        config: {
          coder: "codex",
          reviewer: "claude",
          roles: { coder: { provider: "codex" }, reviewer: { provider: "claude" } },
          max_iterations: 5,
          session: { max_total_minutes: 120 }
        }
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Fix auth bug");
      expect(output).toContain("codex");
      expect(output).toContain("claude");
      expect(output).toContain("5");
      expect(output).toContain("120");
    });
  });

  describe("printEvent", () => {
    let spy;

    beforeEach(() => {
      spy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("prints iteration start with iteration number", () => {
      printEvent({ type: "iteration:start", detail: { iteration: 2, maxIterations: 5 }, elapsed: 30000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Iteration 2/5");
    });

    it("prints coder start with provider name", () => {
      printEvent({ type: "coder:start", detail: { coder: "codex" } });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Coder");
      expect(output).toContain("codex");
    });

    it("prints reviewer approved", () => {
      printEvent({ type: "reviewer:end", detail: { approved: true }, elapsed: 5000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("APPROVED");
    });

    it("prints reviewer rejected with blocking count", () => {
      printEvent({
        type: "reviewer:end",
        detail: { approved: false, blockingCount: 3, issues: ["Issue A", "Issue B"] }
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("REJECTED");
      expect(output).toContain("3 blocking");
      expect(output).toContain("Issue A");
    });

    it("prints sonar gate status", () => {
      printEvent({ type: "sonar:end", status: "ok", detail: { gateStatus: "OK" }, elapsed: 2000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Quality gate");
      expect(output).toContain("OK");
    });

    it("prints question event with pause message", () => {
      printEvent({ type: "question", detail: { question: "Should I proceed?" }, sessionId: "s_123" });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Paused");
      expect(output).toContain("Should I proceed?");
      expect(output).toContain("s_123");
    });

    it("prints default fallback for unknown event types", () => {
      printEvent({ type: "custom:event", message: "Something happened", elapsed: 1000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Something happened");
    });
  });
});

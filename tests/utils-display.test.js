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

    // --- Researcher events ---

    it("prints researcher start", () => {
      printEvent({ type: "researcher:start", detail: { researcher: "claude" } });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Researcher");
      expect(output).toContain("claude");
    });

    it("prints researcher end with status ok", () => {
      printEvent({ type: "researcher:end", status: "ok", elapsed: 8000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Researcher");
      expect(output).toContain("completed");
    });

    // --- Tester events ---

    it("prints tester start", () => {
      printEvent({ type: "tester:start", detail: {} });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Tester");
    });

    it("prints tester end passed", () => {
      printEvent({ type: "tester:end", status: "ok", detail: { ok: true }, elapsed: 5000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Tester");
      expect(output).toContain("passed");
    });

    it("prints tester end failed with summary", () => {
      printEvent({ type: "tester:end", status: "fail", detail: { ok: false, summary: "3 tests failing" }, elapsed: 5000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Tester");
      expect(output).toContain("3 tests failing");
    });

    // --- Security events ---

    it("prints security start", () => {
      printEvent({ type: "security:start", detail: {} });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Security");
    });

    it("prints security end passed", () => {
      printEvent({ type: "security:end", status: "ok", detail: { ok: true }, elapsed: 4000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Security");
      expect(output).toContain("passed");
    });

    it("prints security end failed", () => {
      printEvent({ type: "security:end", status: "fail", detail: { ok: false, summary: "SQL injection found" }, elapsed: 4000 });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Security");
      expect(output).toContain("SQL injection found");
    });

    // --- Solomon events ---

    it("prints solomon start with conflict stage", () => {
      printEvent({ type: "solomon:start", detail: { conflictStage: "reviewer" } });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Solomon");
      expect(output).toContain("reviewer");
    });

    it("prints solomon end with approve ruling", () => {
      printEvent({
        type: "solomon:end",
        detail: {
          ruling: "approve",
          dismissed: ["Style issue — preference"],
          conditions: []
        },
        elapsed: 3000
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Solomon");
      expect(output).toContain("APPROVE");
      expect(output).toContain("1 dismissed");
    });

    it("prints solomon end with approve_with_conditions ruling", () => {
      printEvent({
        type: "solomon:end",
        detail: {
          ruling: "approve_with_conditions",
          conditions: ["Fix null check at auth.js:42"],
          dismissed: []
        },
        elapsed: 3000
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Solomon");
      expect(output).toContain("1 condition");
      expect(output).toContain("Fix null check at auth.js:42");
    });

    it("prints solomon end with escalate_human ruling", () => {
      printEvent({
        type: "solomon:end",
        detail: {
          ruling: "escalate_human",
          escalate_reason: "Architecture decision beyond scope"
        },
        elapsed: 3000
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Solomon");
      expect(output).toContain("ESCALATE");
      expect(output).toContain("Architecture decision beyond scope");
    });

    it("prints solomon end with create_subtask ruling", () => {
      printEvent({
        type: "solomon:end",
        detail: {
          ruling: "create_subtask",
          subtask: { title: "Extract shared validation", description: "Create shared module" }
        },
        elapsed: 3000
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Solomon");
      expect(output).toContain("SUBTASK");
      expect(output).toContain("Extract shared validation");
    });

    it("prints solomon escalate event (sub-loop limit)", () => {
      printEvent({
        type: "solomon:escalate",
        detail: { subloop: "sonar", retryCount: 3, limit: 3, gateStatus: "ERROR" }
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("sonar");
      expect(output).toContain("3/3");
    });

    // --- Enhanced session:end with full summary ---

    it("prints session end with comprehensive summary when approved", () => {
      printEvent({
        type: "session:end",
        detail: {
          approved: true,
          iterations: 2,
          stages: {
            researcher: { ok: true, summary: "Found 3 relevant patterns" },
            planner: { ok: true },
            sonar: { gateStatus: "OK", openIssues: 0 },
            tester: { ok: true, summary: "All tests passed" },
            security: { ok: true, summary: "No vulnerabilities found" }
          },
          git: { committed: true, branch: "feat/auth-fix", pushed: true }
        },
        elapsed: 120000
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("APPROVED");
      expect(output).toContain("02:00");
    });

    it("prints session end with pipeline summary lines", () => {
      printEvent({
        type: "session:end",
        detail: {
          approved: true,
          iterations: 3,
          stages: {
            researcher: { ok: true, summary: "Analyzed 5 files" },
            tester: { ok: true, summary: "12 tests passed" },
            security: { ok: true, summary: "Clean" }
          },
          git: { committed: true, branch: "feat/task-42" }
        },
        elapsed: 180000
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("APPROVED");
      expect(output).toContain("Analyzed 5 files");
      expect(output).toContain("12 tests passed");
    });

    it("prints session end failed with reason", () => {
      printEvent({
        type: "session:end",
        detail: { approved: false, reason: "max_iterations", iterations: 5 },
        elapsed: 300000
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("max_iterations");
    });

    // --- Enhanced header ---

    it("printHeader shows active pipeline roles", () => {
      printHeader({
        task: "Add login feature",
        config: {
          coder: "codex",
          reviewer: "claude",
          roles: {
            coder: { provider: "codex" },
            reviewer: { provider: "claude" },
            planner: { provider: "claude" },
            solomon: { provider: "gemini" }
          },
          pipeline: {
            planner: { enabled: true },
            researcher: { enabled: false },
            tester: { enabled: true },
            security: { enabled: true },
            solomon: { enabled: true }
          },
          max_iterations: 5,
          session: { max_total_minutes: 120 }
        }
      });

      const output = spy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Planner");
      expect(output).toContain("Tester");
      expect(output).toContain("Security");
      expect(output).toContain("Solomon");
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  buildDashboard,
  buildDashboardJson,
  formatDuration,
  parseStageFromLog,
} from "../src/utils/status-dashboard.js";

describe("status-dashboard", () => {
  describe("formatDuration", () => {
    it("formats zero", () => {
      expect(formatDuration(0)).toBe("0s");
    });

    it("formats seconds only", () => {
      expect(formatDuration(45_000)).toBe("45s");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(222_000)).toBe("3m 42s");
    });

    it("formats hours, minutes and seconds", () => {
      expect(formatDuration(3_723_000)).toBe("1h 2m 3s");
    });

    it("handles null/undefined gracefully", () => {
      expect(formatDuration(null)).toBe("0s");
      expect(formatDuration(undefined)).toBe("0s");
    });

    it("handles negative values", () => {
      expect(formatDuration(-1000)).toBe("0s");
    });
  });

  describe("parseStageFromLog", () => {
    it("detects current stage from start event", () => {
      const lines = [
        "12:00:00.000 [info] [coder:start] Coder running",
      ];
      const result = parseStageFromLog(lines);
      expect(result.currentStage).toBe("coder");
    });

    it("detects stage completion resets to idle", () => {
      const lines = [
        "12:00:00.000 [info] [coder:start] Coder running",
        "12:00:01.000 [info] [coder:done] Coder finished",
      ];
      const result = parseStageFromLog(lines);
      expect(result.currentStage).toBe("idle");
    });

    it("detects standby state", () => {
      const lines = [
        "12:00:00.000 [info] [coder:start] Coder running",
        "12:00:01.000 [info] [standby] Rate limited",
      ];
      const result = parseStageFromLog(lines);
      expect(result.currentStage).toBe("standby");
    });

    it("captures last event", () => {
      const lines = [
        "12:00:00.000 [info] First event",
        "12:00:01.000 [info] Second event",
      ];
      const result = parseStageFromLog(lines);
      expect(result.lastEvent).toBe("12:00:01.000 [info] Second event");
    });

    it("returns null for empty log", () => {
      const result = parseStageFromLog([]);
      expect(result.currentStage).toBeNull();
      expect(result.lastEvent).toBeNull();
    });
  });

  describe("buildDashboard", () => {
    it("shows 'No active pipeline' when session is null", () => {
      const result = buildDashboard(null, []);
      expect(result).toBe("No active pipeline");
    });

    it("shows pipeline status for a running session", () => {
      const session = {
        status: "running",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:03:42.000Z",
        config_snapshot: { max_iterations: 5 },
        reviewer_retry_count: 1,
      };
      const logLines = [
        "10:00:00.000 [info] [iteration:start] Iteration 2/5",
        "10:01:00.000 [info] [coder:start] Coder running (agent=claude)",
      ];

      const result = buildDashboard(session, logLines);
      expect(result).toContain("Pipeline: RUNNING");
      expect(result).toContain("iteration 2/5");
      expect(result).toContain("3m 42s");
      expect(result).toContain("Current stage: coder");
    });

    it("shows HU statuses when stories are provided", () => {
      const session = {
        status: "running",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:02:00.000Z",
        config_snapshot: { max_iterations: 5 },
      };
      const stories = [
        { id: "HU-001", status: "done", title: "Login page", duration_ms: 130_000 },
        { id: "HU-002", status: "coding", title: "User profile", duration_ms: 92_000 },
        { id: "HU-003", status: "pending", title: "Settings page" },
        { id: "HU-004", status: "blocked", title: "Admin dashboard", blocked_by: ["HU-002"] },
      ];

      const result = buildDashboard(session, [], { stories });
      expect(result).toContain("HUs:");
      expect(result).toContain("HU-001");
      expect(result).toContain("[done]");
      expect(result).toContain("Login page");
      expect(result).toContain("HU-002");
      expect(result).toContain("[coding]");
      expect(result).toContain("User profile");
      expect(result).toContain("<-- current");
      expect(result).toContain("HU-003");
      expect(result).toContain("[pending]");
      expect(result).toContain("HU-004");
      expect(result).toContain("[blocked]");
      expect(result).toContain("needs HU-002");
    });

    it("parses current stage from log lines", () => {
      const session = {
        status: "running",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:01:00.000Z",
        config_snapshot: {},
      };
      const logLines = [
        "10:00:00.000 [info] [reviewer:start] Reviewer running",
        "10:00:30.000 [info] Coder completed, running TDD check",
      ];

      const result = buildDashboard(session, logLines);
      expect(result).toContain("Current stage: reviewer");
      expect(result).toContain("Last event: 10:00:30.000 [info] Coder completed, running TDD check");
    });

    it("shows deferred issues count", () => {
      const session = {
        status: "running",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:01:00.000Z",
        config_snapshot: {},
        deferred_issues: [{ issue: "test" }, { issue: "test2" }],
      };

      const result = buildDashboard(session, []);
      expect(result).toContain("Deferred issues: 2");
    });

    it("handles session with no config_snapshot gracefully", () => {
      const session = {
        status: "completed",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:05:00.000Z",
      };

      const result = buildDashboard(session, []);
      expect(result).toContain("Pipeline: COMPLETED");
      expect(result).toContain("iteration ?/?");
    });

    it("shows HU with original text when title is absent", () => {
      const session = {
        status: "running",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:01:00.000Z",
        config_snapshot: {},
      };
      const stories = [
        { id: "HU-010", status: "pending", original: { text: "Implement auth flow" } },
      ];

      const result = buildDashboard(session, [], { stories });
      expect(result).toContain("Implement auth flow");
    });
  });

  describe("buildDashboardJson", () => {
    it("returns error object when session is null", () => {
      const result = buildDashboardJson(null, []);
      expect(result.ok).toBe(false);
      expect(result.message).toBe("No active pipeline");
    });

    it("returns structured JSON for running session", () => {
      const session = {
        status: "running",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:03:42.000Z",
        config_snapshot: { max_iterations: 5 },
        reviewer_retry_count: 1,
      };
      const logLines = [
        "10:00:00.000 [info] [iteration:start] Iteration 2/5",
        "10:01:00.000 [info] [coder:start] Coder running",
      ];

      const result = buildDashboardJson(session, logLines);
      expect(result.ok).toBe(true);
      expect(result.pipeline.status).toBe("running");
      expect(result.pipeline.iteration).toBe(2);
      expect(result.pipeline.maxIterations).toBe(5);
      expect(result.pipeline.duration_ms).toBe(222_000);
      expect(result.currentStage).toBe("coder");
    });

    it("includes HU stories in JSON output", () => {
      const session = {
        status: "running",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:01:00.000Z",
        config_snapshot: {},
      };
      const stories = [
        { id: "HU-001", status: "done", title: "Login page", blocked_by: [] },
        { id: "HU-002", status: "coding", original: { text: "Profile" }, blocked_by: ["HU-001"] },
      ];

      const result = buildDashboardJson(session, [], { stories });
      expect(result.hus).toHaveLength(2);
      expect(result.hus[0].id).toBe("HU-001");
      expect(result.hus[0].status).toBe("done");
      expect(result.hus[1].title).toBe("Profile");
      expect(result.hus[1].blocked_by).toEqual(["HU-001"]);
    });

    it("returns idle stage when no log events", () => {
      const session = {
        status: "running",
        created_at: "2026-03-31T10:00:00.000Z",
        updated_at: "2026-03-31T10:01:00.000Z",
        config_snapshot: {},
      };

      const result = buildDashboardJson(session, []);
      expect(result.currentStage).toBe("idle");
      expect(result.lastEvent).toBeNull();
    });
  });
});

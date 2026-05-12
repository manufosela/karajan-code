import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { buildProgressHandler, buildProgressNotifier, buildPipelineTracker, sendTrackerLog, PROGRESS_STAGES } from "../src/mcp/progress.js";

describe("mcp/progress", () => {
  describe("PROGRESS_STAGES", () => {
    it("includes all core orchestrator event types", () => {
      expect(PROGRESS_STAGES).toContain("session:start");
      expect(PROGRESS_STAGES).toContain("iteration:start");
      expect(PROGRESS_STAGES).toContain("coder:start");
      expect(PROGRESS_STAGES).toContain("coder:end");
      expect(PROGRESS_STAGES).toContain("sonar:start");
      expect(PROGRESS_STAGES).toContain("sonar:end");
      expect(PROGRESS_STAGES).toContain("reviewer:start");
      expect(PROGRESS_STAGES).toContain("reviewer:end");
      expect(PROGRESS_STAGES).toContain("session:end");
    });

    it("includes solomon:escalate and question events", () => {
      expect(PROGRESS_STAGES).toContain("solomon:escalate");
      expect(PROGRESS_STAGES).toContain("question");
    });

    it("includes dry-run:summary event", () => {
      expect(PROGRESS_STAGES).toContain("dry-run:summary");
    });

    it("includes pipeline:tracker event", () => {
      expect(PROGRESS_STAGES).toContain("pipeline:tracker");
    });

    it("has iteration:start before iteration:end", () => {
      const startIdx = PROGRESS_STAGES.indexOf("iteration:start");
      const endIdx = PROGRESS_STAGES.indexOf("iteration:end");
      expect(startIdx).toBeLessThan(endIdx);
    });
  });

  describe("buildProgressHandler", () => {
    it("sends logging message with event data", () => {
      const server = { sendLoggingMessage: vi.fn() };
      const handler = buildProgressHandler(server);

      const event = { type: "coder:start", status: "ok", message: "Coder running" };
      handler(event);

      expect(server.sendLoggingMessage).toHaveBeenCalledWith({
        level: "info",
        logger: "karajan",
        data: event
      });
    });

    it("uses debug level for agent:output events", () => {
      const server = { sendLoggingMessage: vi.fn() };
      const handler = buildProgressHandler(server);

      handler({ type: "agent:output", status: "ok", message: "output line" });

      expect(server.sendLoggingMessage).toHaveBeenCalledWith(
        expect.objectContaining({ level: "debug" })
      );
    });

    it("uses error level for fail status events", () => {
      const server = { sendLoggingMessage: vi.fn() };
      const handler = buildProgressHandler(server);

      handler({ type: "sonar:end", status: "fail", message: "Quality gate failed" });

      expect(server.sendLoggingMessage).toHaveBeenCalledWith(
        expect.objectContaining({ level: "error" })
      );
    });

    it("does not throw if sendLoggingMessage throws", () => {
      const server = { sendLoggingMessage: vi.fn().mockImplementation(() => { throw new Error("fail"); }) };
      const handler = buildProgressHandler(server);

      expect(() => handler({ type: "coder:start", status: "ok" })).not.toThrow();
    });
  });

  describe("buildProgressNotifier", () => {
    it("returns null when no progressToken is provided", () => {
      expect(buildProgressNotifier({})).toBeNull();
      expect(buildProgressNotifier(null)).toBeNull();
      expect(buildProgressNotifier(undefined)).toBeNull();
      expect(buildProgressNotifier({ _meta: {} })).toBeNull();
    });

    it("returns a function when progressToken is provided", () => {
      const extra = {
        _meta: { progressToken: "tok-123" },
        sendNotification: vi.fn()
      };

      const notifier = buildProgressNotifier(extra);
      expect(typeof notifier).toBe("function");
    });

    it("sends progress notification for known event types", () => {
      const extra = {
        _meta: { progressToken: "tok-123" },
        sendNotification: vi.fn()
      };
      const notifier = buildProgressNotifier(extra);

      notifier({ type: "coder:start", message: "Coder running" });

      expect(extra.sendNotification).toHaveBeenCalledWith({
        method: "notifications/progress",
        params: {
          progressToken: "tok-123",
          progress: expect.any(Number),
          total: PROGRESS_STAGES.length,
          message: "Coder running"
        }
      });
    });

    it("ignores unknown event types", () => {
      const extra = {
        _meta: { progressToken: "tok-123" },
        sendNotification: vi.fn()
      };
      const notifier = buildProgressNotifier(extra);

      notifier({ type: "unknown:event", message: "Something" });

      expect(extra.sendNotification).not.toHaveBeenCalled();
    });

    it("includes iteration number in message when available", () => {
      const extra = {
        _meta: { progressToken: "tok-123" },
        sendNotification: vi.fn()
      };
      const notifier = buildProgressNotifier(extra);

      notifier({ type: "coder:start", iteration: 3, message: "Coder running" });

      const params = extra.sendNotification.mock.calls[0][0].params;
      expect(params.message).toContain("3");
      expect(params.message).toContain("Coder running");
    });

    it("calculates correct progress index for each stage", () => {
      const extra = {
        _meta: { progressToken: "tok-123" },
        sendNotification: vi.fn()
      };
      const notifier = buildProgressNotifier(extra);

      notifier({ type: "session:start", message: "Started" });
      const firstProgress = extra.sendNotification.mock.calls[0][0].params.progress;
      expect(firstProgress).toBe(1);

      notifier({ type: "session:end", message: "Done" });
      const lastProgress = extra.sendNotification.mock.calls[1][0].params.progress;
      expect(lastProgress).toBe(PROGRESS_STAGES.indexOf("session:end") + 1);
    });

    it("does not throw if sendNotification throws", () => {
      const extra = {
        _meta: { progressToken: "tok-123" },
        sendNotification: vi.fn().mockImplementation(() => { throw new Error("fail"); })
      };
      const notifier = buildProgressNotifier(extra);

      expect(() => notifier({ type: "coder:start", message: "test" })).not.toThrow();
    });

    it("works with progressToken = 0 (falsy but defined)", () => {
      const extra = {
        _meta: { progressToken: 0 },
        sendNotification: vi.fn()
      };
      const notifier = buildProgressNotifier(extra);

      expect(notifier).not.toBeNull();
      notifier({ type: "session:start", message: "Started" });
      expect(extra.sendNotification).toHaveBeenCalled();
    });
  });

  describe("buildPipelineTracker", () => {
    it("builds stage list from config with only enabled stages", () => {
      const emitter = new EventEmitter();
      const config = {
        pipeline: {
          triage: { enabled: true },
          planner: { enabled: true },
          reviewer: { enabled: true }
        }
      };
      const { stages } = buildPipelineTracker(config, emitter);
      const names = stages.map(s => s.name);
      expect(names).toEqual(["triage", "planner", "coder", "reviewer"]);
      expect(stages.every(s => s.status === "pending")).toBe(true);
    });

    it("always includes coder and reviewer by default", () => {
      const emitter = new EventEmitter();
      const config = { pipeline: {} };
      const { stages } = buildPipelineTracker(config, emitter);
      const names = stages.map(s => s.name);
      expect(names).toContain("coder");
      expect(names).toContain("reviewer");
    });

    it("excludes stages not in config", () => {
      const emitter = new EventEmitter();
      const config = { pipeline: {} };
      const { stages } = buildPipelineTracker(config, emitter);
      const names = stages.map(s => s.name);
      expect(names).not.toContain("triage");
      expect(names).not.toContain("planner");
      expect(names).not.toContain("security");
    });

    it("sets stage to running on *:start event", () => {
      const emitter = new EventEmitter();
      const config = { pipeline: {} };
      buildPipelineTracker(config, emitter);

      emitter.emit("progress", { type: "coder:start", detail: { coder: "claude" } });

      // Check via the emitted pipeline:tracker event
      const trackerEvents = [];
      emitter.on("progress", (e) => { if (e.type === "pipeline:tracker") trackerEvents.push(e); });
      emitter.emit("progress", { type: "coder:start", detail: { coder: "codex" } });

      expect(trackerEvents).toHaveLength(1);
      const coderStage = trackerEvents[0].detail.stages.find(s => s.name === "coder");
      expect(coderStage.status).toBe("running");
      expect(coderStage.summary).toBe("codex");
    });

    it("sets stage to done on *:end event", () => {
      const emitter = new EventEmitter();
      const config = { pipeline: {} };
      buildPipelineTracker(config, emitter);

      const trackerEvents = [];
      emitter.on("progress", (e) => { if (e.type === "pipeline:tracker") trackerEvents.push(e); });

      emitter.emit("progress", { type: "coder:end", status: "ok" });

      expect(trackerEvents).toHaveLength(1);
      const coderStage = trackerEvents[0].detail.stages.find(s => s.name === "coder");
      expect(coderStage.status).toBe("done");
    });

    it("sets stage to failed on *:end with status fail", () => {
      const emitter = new EventEmitter();
      const config = { pipeline: {} };
      buildPipelineTracker(config, emitter);

      const trackerEvents = [];
      emitter.on("progress", (e) => { if (e.type === "pipeline:tracker") trackerEvents.push(e); });

      emitter.emit("progress", { type: "reviewer:end", status: "fail" });

      expect(trackerEvents).toHaveLength(1);
      const reviewerStage = trackerEvents[0].detail.stages.find(s => s.name === "reviewer");
      expect(reviewerStage.status).toBe("failed");
    });

    it("emits pipeline:tracker event after each transition", () => {
      const emitter = new EventEmitter();
      const config = { pipeline: { planner: { enabled: true } } };
      buildPipelineTracker(config, emitter);

      const trackerEvents = [];
      emitter.on("progress", (e) => { if (e.type === "pipeline:tracker") trackerEvents.push(e); });

      emitter.emit("progress", { type: "planner:start", detail: { planner: "claude" } });
      emitter.emit("progress", { type: "planner:end", status: "ok" });
      emitter.emit("progress", { type: "coder:start", detail: { coder: "codex" } });

      expect(trackerEvents).toHaveLength(3);
    });
  });

  describe("sendTrackerLog", () => {
    it("sends logging message with tracker payload", () => {
      const server = { sendLoggingMessage: vi.fn() };
      sendTrackerLog(server, "coder", "running", "claude");

      expect(server.sendLoggingMessage).toHaveBeenCalledWith({
        level: "info",
        logger: "karajan",
        data: {
          type: "pipeline:tracker",
          detail: {
            stages: [{ name: "coder", status: "running", summary: "claude" }]
          }
        }
      });
    });

    it("omits summary when not provided", () => {
      const server = { sendLoggingMessage: vi.fn() };
      sendTrackerLog(server, "reviewer", "done");

      const data = server.sendLoggingMessage.mock.calls[0][0].data;
      expect(data.detail.stages[0].summary).toBeUndefined();
    });

    it("does not throw if sendLoggingMessage throws", () => {
      const server = { sendLoggingMessage: vi.fn().mockImplementation(() => { throw new Error("fail"); }) };
      expect(() => sendTrackerLog(server, "coder", "running")).not.toThrow();
    });
  });
});

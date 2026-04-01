import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { createProgressMonitor } from "../src/proxy/progress-monitor.js";

describe("createProgressMonitor", () => {
  let emitter;
  let interceptorEmitter;
  let monitor;
  const stage = "coder";
  const provider = "anthropic";

  beforeEach(() => {
    emitter = new EventEmitter();
    interceptorEmitter = new EventEmitter();
    monitor = createProgressMonitor({
      emitter,
      interceptorEmitter,
      stage,
      provider,
    });
  });

  describe("tool_call events", () => {
    it("emits proxy:tool_call on interceptor tool_call", () => {
      const events = [];
      emitter.on("progress", (ev) => events.push(ev));

      interceptorEmitter.emit("tool_call", {
        name: "Read",
        id: "tool_abc123",
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "proxy:tool_call",
        stage: "coder",
        provider: "anthropic",
        tool: "Read",
        input: "tool_abc123",
      });
      expect(typeof events[0].timestamp).toBe("number");
    });

    it("truncates input to 100 chars", () => {
      const events = [];
      emitter.on("progress", (ev) => events.push(ev));

      const longId = "x".repeat(200);
      interceptorEmitter.emit("tool_call", { name: "Bash", id: longId });

      expect(events[0].input).toBe("x".repeat(100) + "...");
    });

    it("handles missing id gracefully", () => {
      const events = [];
      emitter.on("progress", (ev) => events.push(ev));

      interceptorEmitter.emit("tool_call", { name: "Edit" });

      expect(events[0].input).toBe("");
    });

    it("increments toolCalls stat", () => {
      interceptorEmitter.emit("tool_call", { name: "Read", id: "t1" });
      interceptorEmitter.emit("tool_call", { name: "Write", id: "t2" });
      interceptorEmitter.emit("tool_call", { name: "Bash", id: "t3" });

      expect(monitor.getStats().toolCalls).toBe(3);
    });
  });

  describe("usage events", () => {
    it("emits proxy:usage on interceptor usage", () => {
      const events = [];
      emitter.on("progress", (ev) => events.push(ev));

      interceptorEmitter.emit("usage", {
        input_tokens: 500,
        output_tokens: 200,
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "proxy:usage",
        stage: "coder",
        provider: "anthropic",
        input_tokens: 500,
        output_tokens: 200,
      });
      expect(typeof events[0].timestamp).toBe("number");
    });

    it("accumulates token stats across multiple events", () => {
      interceptorEmitter.emit("usage", {
        input_tokens: 100,
        output_tokens: 50,
      });
      interceptorEmitter.emit("usage", {
        input_tokens: 200,
        output_tokens: 75,
      });

      const stats = monitor.getStats();
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(125);
    });

    it("handles missing token values as zero", () => {
      interceptorEmitter.emit("usage", {});

      const stats = monitor.getStats();
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
    });
  });

  describe("message_complete events", () => {
    it("emits proxy:message_complete on interceptor message_complete", () => {
      const events = [];
      emitter.on("progress", (ev) => events.push(ev));

      interceptorEmitter.emit("message_complete", {});

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "proxy:message_complete",
        stage: "coder",
        provider: "anthropic",
      });
      expect(typeof events[0].timestamp).toBe("number");
    });
  });

  describe("getStats", () => {
    it("returns initial zeroed stats", () => {
      expect(monitor.getStats()).toEqual({
        toolCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      });
    });

    it("returns a copy (not a reference)", () => {
      const stats1 = monitor.getStats();
      interceptorEmitter.emit("tool_call", { name: "Read", id: "t1" });
      const stats2 = monitor.getStats();

      expect(stats1.toolCalls).toBe(0);
      expect(stats2.toolCalls).toBe(1);
    });
  });

  describe("stop", () => {
    it("unsubscribes from all interceptor events", () => {
      const events = [];
      emitter.on("progress", (ev) => events.push(ev));

      monitor.stop();

      interceptorEmitter.emit("tool_call", { name: "Read", id: "t1" });
      interceptorEmitter.emit("usage", {
        input_tokens: 100,
        output_tokens: 50,
      });
      interceptorEmitter.emit("message_complete", {});

      expect(events).toHaveLength(0);
    });

    it("preserves stats after stop", () => {
      interceptorEmitter.emit("tool_call", { name: "Read", id: "t1" });
      interceptorEmitter.emit("usage", {
        input_tokens: 100,
        output_tokens: 50,
      });

      monitor.stop();

      expect(monitor.getStats()).toEqual({
        toolCalls: 1,
        totalInputTokens: 100,
        totalOutputTokens: 50,
      });
    });
  });

  describe("full scenario", () => {
    it("tracks a complete message lifecycle", () => {
      const events = [];
      emitter.on("progress", (ev) => events.push(ev));

      // Simulate a typical AI response
      interceptorEmitter.emit("usage", {
        input_tokens: 1000,
        output_tokens: 0,
      });
      interceptorEmitter.emit("tool_call", {
        name: "Read",
        id: "tool_001",
      });
      interceptorEmitter.emit("tool_call", {
        name: "Edit",
        id: "tool_002",
      });
      interceptorEmitter.emit("usage", {
        input_tokens: 0,
        output_tokens: 350,
      });
      interceptorEmitter.emit("message_complete", {});

      expect(events).toHaveLength(5);
      expect(events.map((e) => e.type)).toEqual([
        "proxy:usage",
        "proxy:tool_call",
        "proxy:tool_call",
        "proxy:usage",
        "proxy:message_complete",
      ]);

      const stats = monitor.getStats();
      expect(stats.toolCalls).toBe(2);
      expect(stats.totalInputTokens).toBe(1000);
      expect(stats.totalOutputTokens).toBe(350);
    });
  });
});

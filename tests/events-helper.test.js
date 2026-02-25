import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { emitProgress, makeEvent } from "../src/utils/events.js";

describe("emitProgress", () => {
  it("emits 'progress' event on emitter", () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on("progress", handler);

    emitProgress(emitter, { type: "test", message: "hello" });

    expect(handler).toHaveBeenCalledWith({ type: "test", message: "hello" });
  });

  it("does nothing when emitter is null", () => {
    expect(() => emitProgress(null, { type: "test" })).not.toThrow();
  });

  it("does nothing when emitter is undefined", () => {
    expect(() => emitProgress(undefined, { type: "test" })).not.toThrow();
  });
});

describe("makeEvent", () => {
  it("creates event with all base fields", () => {
    const base = { sessionId: "s1", iteration: 2, stage: "coder", startedAt: Date.now() - 1000 };
    const event = makeEvent("coder:start", base);

    expect(event.type).toBe("coder:start");
    expect(event.sessionId).toBe("s1");
    expect(event.iteration).toBe(2);
    expect(event.stage).toBe("coder");
    expect(event.status).toBe("ok");
    expect(event.message).toBe("coder:start");
    expect(event.elapsed).toBeGreaterThanOrEqual(900);
    expect(event.timestamp).toBeTruthy();
  });

  it("overrides status and message from extra", () => {
    const base = { sessionId: "s1", iteration: 1, stage: "sonar" };
    const event = makeEvent("sonar:end", base, { status: "fail", message: "Quality gate failed" });

    expect(event.status).toBe("fail");
    expect(event.message).toBe("Quality gate failed");
  });

  it("includes detail from extra", () => {
    const base = { sessionId: "s1", iteration: 1, stage: "test" };
    const event = makeEvent("test:end", base, { detail: { coverage: 85 } });

    expect(event.detail.coverage).toBe(85);
  });

  it("sets elapsed to 0 when startedAt is missing", () => {
    const base = { sessionId: "s1", iteration: 0, stage: "init" };
    const event = makeEvent("session:start", base);

    expect(event.elapsed).toBe(0);
  });
});

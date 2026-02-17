import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/utils/logger.js";

describe("createLogger", () => {
  it("respects level filtering", () => {
    const logger = createLogger("warn", "silent");
    const spy = vi.fn();
    logger.onLog(spy);

    logger.debug("nope");
    logger.info("nope");
    logger.warn("yes");
    logger.error("yes");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0].level).toBe("warn");
    expect(spy.mock.calls[1][0].level).toBe("error");
  });

  it("includes timestamp in log entries", () => {
    const logger = createLogger("info", "silent");
    const spy = vi.fn();
    logger.onLog(spy);

    logger.info("test");
    expect(spy.mock.calls[0][0].timestamp).toBeTruthy();
    expect(spy.mock.calls[0][0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("setContext enriches log entries", () => {
    const logger = createLogger("info", "silent");
    const spy = vi.fn();
    logger.onLog(spy);

    logger.setContext({ iteration: 2, stage: "coder" });
    logger.info("in context");

    expect(spy.mock.calls[0][0].context.iteration).toBe(2);
    expect(spy.mock.calls[0][0].context.stage).toBe("coder");
  });

  it("resetContext clears context", () => {
    const logger = createLogger("info", "silent");
    const spy = vi.fn();
    logger.onLog(spy);

    logger.setContext({ iteration: 1 });
    logger.resetContext();
    logger.info("cleared");

    expect(spy.mock.calls[0][0].context).toEqual({});
  });

  it("onLog callback can be removed with offLog", () => {
    const logger = createLogger("info", "silent");
    const spy = vi.fn();
    logger.onLog(spy);
    logger.info("first");
    logger.offLog(spy);
    logger.info("second");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("mode property returns the configured mode", () => {
    expect(createLogger("info", "cli").mode).toBe("cli");
    expect(createLogger("info", "mcp").mode).toBe("mcp");
    expect(createLogger("info", "silent").mode).toBe("silent");
  });

  it("silent mode does not write to console", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("info", "silent");
    logger.info("test");
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("mcp mode does not write to console but emits events", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("info", "mcp");
    const spy = vi.fn();
    logger.onLog(spy);

    logger.info("test");
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it("concatenates multiple arguments into message", () => {
    const logger = createLogger("info", "silent");
    const spy = vi.fn();
    logger.onLog(spy);

    logger.info("hello", "world", 42);
    expect(spy.mock.calls[0][0].message).toBe("hello world 42");
  });
});

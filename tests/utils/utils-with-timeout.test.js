import { describe, expect, it } from "vitest";
import { withTimeout, TimeoutError } from "../../src/utils/with-timeout.js";

describe("utils/with-timeout", () => {
  it("resolves when the promise settles within the deadline", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000);
    expect(result).toBe("ok");
  });

  it("rejects with TimeoutError when the deadline passes", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
    await expect(withTimeout(slow, 30, "probe")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("propagates the original rejection when it happens first", async () => {
    const err = new Error("boom");
    await expect(withTimeout(Promise.reject(err), 1000)).rejects.toBe(err);
  });

  it("returns the original promise when ms is 0 or negative", async () => {
    const p = Promise.resolve("passthrough");
    expect(await withTimeout(p, 0)).toBe("passthrough");
    expect(await withTimeout(Promise.resolve("x"), -1)).toBe("x");
  });

  it("includes the label in the TimeoutError", async () => {
    const slow = new Promise(() => {});
    try {
      await withTimeout(slow, 20, "mcp-ping");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err.label).toBe("mcp-ping");
      expect(err.timeoutMs).toBe(20);
      expect(err.message).toContain("mcp-ping");
    }
  });
});

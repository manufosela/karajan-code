import { describe, expect, it } from "vitest";

import { withLock } from "../src/utils/async-lock.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("async-lock (KJC-TSK-0625)", () => {
  it("serializes same-name sections in FIFO order", async () => {
    const order = [];
    await Promise.all([
      withLock("sonar", async () => {
        order.push("a-in");
        await sleep(20);
        order.push("a-out");
      }),
      withLock("sonar", async () => {
        order.push("b-in");
        await sleep(5);
        order.push("b-out");
      }),
      withLock("sonar", async () => order.push("c")),
    ]);
    expect(order).toEqual(["a-in", "a-out", "b-in", "b-out", "c"]);
  });

  it("different names run concurrently", async () => {
    const order = [];
    await Promise.all([
      withLock("x", async () => {
        order.push("x-in");
        await sleep(20);
        order.push("x-out");
      }),
      withLock("y", async () => order.push("y")),
    ]);
    expect(order).toEqual(["x-in", "y", "x-out"]);
  });

  it("a throwing section releases the lock for the next caller", async () => {
    await expect(withLock("boom", async () => {
      throw new Error("kaput");
    })).rejects.toThrow("kaput");
    const result = await withLock("boom", async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("returns the section's value", async () => {
    expect(await withLock("v", async () => 42)).toBe(42);
  });
});

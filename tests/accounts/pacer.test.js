import { describe, expect, it } from "vitest";
import { createPacer } from "../../src/accounts/pacer.js";

const setup = () => {
  const clock = { t: 1000, sleeps: [] };
  const pacer = createPacer({
    now: () => clock.t,
    sleep: async (ms) => { clock.sleeps.push(ms); clock.t += ms; },
  });
  return { clock, pacer };
};
const ok = { exitCode: 0, stdout: "", stderr: "" };

describe("pacer (HU-4591)", () => {
  it("waits the gap since the last call ended", async () => {
    const { clock, pacer } = setup();
    await pacer.run("a", { gapSeconds: 5 }, async () => ok);
    await pacer.run("a", { gapSeconds: 5 }, async () => ok);
    expect(clock.sleeps).toEqual([5000]);
  });

  it("runs at most maxConcurrent calls at once", async () => {
    const { pacer } = setup();
    let active = 0;
    let peak = 0;
    const fn = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return ok;
    };
    await Promise.all([1, 2, 3, 4].map(() => pacer.run("a", { maxConcurrent: 2 }, fn)));
    expect(peak).toBe(2);
  });

  it("waits limitWaitSeconds after a limit message", async () => {
    const { clock, pacer } = setup();
    const limited = { exitCode: 1, stdout: "", stderr: "429 Too Many Requests: rate limit exceeded" };
    await pacer.run("a", { gapSeconds: 1, limitWaitSeconds: 60 }, async () => limited);
    await pacer.run("a", { gapSeconds: 1, limitWaitSeconds: 60 }, async () => ok);
    expect(clock.sleeps).toEqual([60000]);
  });

  it("does not wait nor keep state without a pace", async () => {
    const { clock, pacer } = setup();
    await pacer.run("a", undefined, async () => ok);
    await pacer.run("a", undefined, async () => ok);
    expect(clock.sleeps).toEqual([]);
  });

  it("keeps accounts independent", async () => {
    const { clock, pacer } = setup();
    await pacer.run("a", { gapSeconds: 5 }, async () => ok);
    await pacer.run("b", { gapSeconds: 5 }, async () => ok);
    expect(clock.sleeps).toEqual([]);
  });

  it("releases the slot when the call fails", async () => {
    const { pacer } = setup();
    await expect(pacer.run("a", { maxConcurrent: 1 }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(pacer.run("a", { maxConcurrent: 1 }, async () => ok)).resolves.toBe(ok);
  });
});

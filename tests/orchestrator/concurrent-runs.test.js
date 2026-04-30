/**
 * TSK-0338 — concurrent pipeline runs don't cross-contaminate per-run state
 * (runner, projectDir, snapshot). Exercised at the AsyncLocalStorage level.
 */
import { describe, expect, it } from "vitest";
import { withRunContext, getRunContext } from "../../src/utils/run-context.js";

// regression-for: TSK-0338
describe("TSK-0338 — per-run context isolation", () => {
  it("two parallel withRunContext scopes see their own runner, not each other's", async () => {
    const runnerA = (cmd) => Promise.resolve({ tag: "A", cmd });
    const runnerB = (cmd) => Promise.resolve({ tag: "B", cmd });
    const obs = { a: [], b: [] };

    const pipeline = (key, runner, delay) => async () => {
      // ALS must still resolve to the right runner across every `await`.
      obs[key].push(getRunContext()?.runner === runner);
      await new Promise((r) => setTimeout(r, delay));
      obs[key].push(getRunContext()?.runner === runner);
      // Audit-fix #2: was `getRunContext()?.runner(...)` which would throw
      // if the optional chain short-circuited. The test asserts that a
      // runner exists, so use a non-optional access here — if it's
      // undefined the test should fail loudly, not silently.
      const ctx = getRunContext();
      const res = await ctx.runner(`${key}-cmd`);
      obs[key].push(res.tag === key.toUpperCase());
    };

    await Promise.all([
      withRunContext({ runner: runnerA }, pipeline("a", runnerA, 10)),
      withRunContext({ runner: runnerB }, pipeline("b", runnerB, 5)),
    ]);

    expect(obs.a).toEqual([true, true, true]);
    expect(obs.b).toEqual([true, true, true]);
  });

  it("projectDir and snapshot are isolated too", async () => {
    const snapA = new Map([["a.js", "content-a"]]);
    const snapB = new Map([["b.js", "content-b"]]);

    const captured = { a: null, b: null };

    await Promise.all([
      withRunContext({ projectDir: "/proj/a", snapshot: snapA }, async () => {
        await new Promise((r) => setTimeout(r, 8));
        const ctx = getRunContext();
        captured.a = { projectDir: ctx?.projectDir, snapshot: ctx?.snapshot };
      }),
      withRunContext({ projectDir: "/proj/b", snapshot: snapB }, async () => {
        await new Promise((r) => setTimeout(r, 3));
        const ctx = getRunContext();
        captured.b = { projectDir: ctx?.projectDir, snapshot: ctx?.snapshot };
      }),
    ]);

    expect(captured.a).toEqual({ projectDir: "/proj/a", snapshot: snapA });
    expect(captured.b).toEqual({ projectDir: "/proj/b", snapshot: snapB });
  });

  it("getRunContext() returns undefined outside any scope", () => {
    expect(getRunContext()).toBeUndefined();
  });

  it("mutations to the store propagate to awaited callees (initFlowContext pattern)", async () => {
    // init-context.js mutates runCtx.runner AFTER the ALS scope is open;
    // verify the mutation is visible to subsequent awaited reads.
    const runner = () => Promise.resolve("installed");
    let earlyRunner, lateRunner;
    await withRunContext({}, async () => {
      earlyRunner = getRunContext()?.runner;
      getRunContext().runner = runner;
      await new Promise((r) => setTimeout(r, 5));
      lateRunner = getRunContext()?.runner;
    });
    expect(earlyRunner).toBeUndefined();
    expect(lateRunner).toBe(runner);
  });
});

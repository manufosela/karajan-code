/**
 * TSK-0338 regression test — concurrent pipeline runs don't cross-contaminate
 * per-run state (runner, projectDir, snapshot).
 *
 * Pre-v2.7.5 those values lived in module-scope `let _runner / _projectDir /
 * _snapshot` slots in `utils/git.js` and `review/diff-generator.js`. Two
 * `runFlow` calls in parallel (MCP multi-client) would overwrite each
 * other's slots during setup.
 *
 * TSK-0338 isolates them in an AsyncLocalStorage store scoped per
 * `withRunContext(...)` call (wrapped around every `runFlow`). This test
 * exercises that isolation at the store level — no heavy mocks required.
 */

import { describe, expect, it } from "vitest";
import {
  withRunContext, getRunContext,
} from "../../src/utils/run-context.js";

// regression-for: TSK-0338
describe("TSK-0338 — per-run context isolation", () => {
  it("two parallel withRunContext scopes see their own runner, not each other's", async () => {
    const runnerA = (cmd) => Promise.resolve({ tag: "A", cmd });
    const runnerB = (cmd) => Promise.resolve({ tag: "B", cmd });

    const observations = { a: [], b: [] };

    async function pipelineA() {
      // Simulate async boundaries inside the pipeline (await points) — ALS
      // must still resolve to runnerA across every `await`.
      observations.a.push(getRunContext()?.runner === runnerA);
      await new Promise((r) => setTimeout(r, 10));
      observations.a.push(getRunContext()?.runner === runnerA);
      const res = await (getRunContext()?.runner)("a-cmd");
      observations.a.push(res.tag === "A");
    }

    async function pipelineB() {
      observations.b.push(getRunContext()?.runner === runnerB);
      await new Promise((r) => setTimeout(r, 5));
      observations.b.push(getRunContext()?.runner === runnerB);
      const res = await (getRunContext()?.runner)("b-cmd");
      observations.b.push(res.tag === "B");
    }

    await Promise.all([
      withRunContext({ runner: runnerA }, pipelineA),
      withRunContext({ runner: runnerB }, pipelineB),
    ]);

    expect(observations.a).toEqual([true, true, true]);
    expect(observations.b).toEqual([true, true, true]);
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
    // init-context.js writes runCtx.runner = rtkRunner AFTER the ALS scope
    // has been established by runFlow. Verify that mutation is visible to
    // subsequent awaited reads — which is what makes the RTK install path
    // work without a module-level setter.
    const runner = () => Promise.resolve("installed");
    let earlyRunner;
    let lateRunner;

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

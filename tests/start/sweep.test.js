import { describe, it, expect } from "vitest";
import { runReadOnlySweep } from "../../src/start/sweep.js";

/**
 * KJC-TSK-0568 (Onboard A) — read-only sweep orchestrator.
 *
 * Deterministic, no LLM. Dependencies are injected so the test never touches
 * git/fs and stays fast. Asserts: maturity-driven subset (new = minimal;
 * existing/legacy = + drift/harden/rag/qmd), derived signals, and fail-soft
 * slots (a throwing collector yields null, never a crash).
 */
function fakeDeps(over = {}) {
  return {
    collectAll: async () => ({
      stack: { language: "javascript" },
      tree: [{ path: "src", kind: "dir", children: ["index", "app", "util", "core"].map(
        (n) => ({ path: `src/${n}.js`, kind: "file", bytes: 100 })) }],
      git: { commitCount: 50, headSha: "abc" },
      configs: { present: ["package.json", ".github/workflows"], scripts: { test: "vitest" } },
    }),
    detectTestFramework: async () => ({ hasTests: true, framework: "vitest", language: "javascript" }),
    checkHarden: async () => ({ ok: true, checks: [] }),
    compareHarden: () => ({ artifacts: [{ id: "eslint", recommendation: "keep" }] }),
    detectQmd: async () => ({ available: true, version: "1.0" }),
    ragStatus: () => ({ indexed: true, chunks: 42, lastIndexedCommit: "abc" }),
    gitAgeDays: () => 3,
    ...over,
  };
}

describe("runReadOnlySweep (KJC-TSK-0568)", () => {
  it("infers existing, derives signals, and runs the full subset", async () => {
    const b = await runReadOnlySweep("/x", { deps: fakeDeps() });
    expect(b.maturity.maturity).toBe("existing");
    expect(b.signals).toMatchObject({
      hasSourceCode: true, scaffoldingOnly: false, hasTests: true,
      hasCI: true, commitCount: 50, staleDays: 3,
    });
    for (const slot of [b.drift, b.improvements, b.rag, b.qmd]) expect(slot).not.toBeNull();
  });

  it("a declared-new project gets the minimal subset (no drift/harden/rag/qmd)", async () => {
    const b = await runReadOnlySweep("/x", { declared: "new", deps: fakeDeps() });
    expect(b.maturity.maturity).toBe("new");
    expect(b.drift).toBeNull();
    expect(b.improvements).toBeNull();
    expect(b.rag).toBeNull();
    expect(b.qmd).toBeNull();
    expect(b.brief).not.toBeNull();
  });

  it("flags legacy (no CI) with deepHealthRecommended", async () => {
    const deps = fakeDeps({
      collectAll: async () => ({
        tree: [{ path: "src/a.js", kind: "file", bytes: 10 }, { path: "src/b.js", kind: "file", bytes: 20 }],
        git: { commitCount: 30 },
        configs: { present: ["package.json"], scripts: {} },
      }),
    });
    const b = await runReadOnlySweep("/x", { deps });
    expect(b.maturity.maturity).toBe("legacy");
    expect(b.maturity.deepHealthRecommended).toBe(true);
    expect(b.signals.hasCI).toBe(false);
  });

  it("treats a freshly-scaffolded repo as new", async () => {
    const deps = fakeDeps({
      collectAll: async () => ({
        tree: [{ path: "index.js", kind: "file", bytes: 10 }],
        git: { commitCount: 1 },
        configs: { present: ["package.json"], scripts: {} },
      }),
      detectTestFramework: async () => ({ hasTests: false }),
    });
    const b = await runReadOnlySweep("/x", { deps });
    expect(b.maturity.maturity).toBe("new");
  });

  it("is fail-soft: a throwing collector yields a null slot, not a crash", async () => {
    const deps = fakeDeps({
      checkHarden: async () => { throw new Error("boom"); },
    });
    const b = await runReadOnlySweep("/x", { deps });
    expect(b.drift).toBeNull();
    expect(b.improvements).not.toBeNull();
  });
});

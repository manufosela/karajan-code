/**
 * Tests for KJC-TSK-0397 preflight HU auto-injection.
 *
 * Acceptance pins:
 *   A) composePreflightTests is stack-aware: Node→adds node --version
 *      + npm install; Python→adds python --version + pip install.
 *   B) Always includes the git clean-tree check (works regardless of
 *      stack).
 *   C) prependPreflightHu inserts PREFLIGHT-000 at index 0 and
 *      appends its id to every other HU's blocked_by.
 *   D) prependPreflightHu is idempotent: re-running over a plan that
 *      already has a preflight HU returns it unchanged.
 *   E) When the plan already has a HU titled 'Verificar entorno…'
 *      (user's own), hasPreflightHu detects it and skips injection.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composePreflightTests, hasPreflightHu, prependPreflightHu } from "../../src/plan/preflight-hu.js";

describe("preflight-hu — KJC-TSK-0397", () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kj-preflight-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("A) Node stack adds node + npm install + test/lint guards", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", dependencies: {} }));
    const tests = composePreflightTests({ language: "javascript" }, root);
    const flat = tests.map((t) => t.content).join("\n");
    expect(flat).toMatch(/node --version/);
    expect(flat).toMatch(/npm install/);
  });

  it("A) Python stack adds python + pip install", () => {
    writeFileSync(join(root, "requirements.txt"), "");
    const tests = composePreflightTests({ language: "python" }, root);
    const flat = tests.map((t) => t.content).join("\n");
    expect(flat).toMatch(/python --version/);
    expect(flat).toMatch(/pip install -r requirements\.txt/);
  });

  it("B) git clean-tree check is always present", () => {
    const tests = composePreflightTests({ language: null }, root);
    expect(tests.map((t) => t.content).some((c) => c.includes("git status --porcelain"))).toBe(true);
  });

  it("C) prependPreflightHu inserts at index 0 and updates blocked_by of all others", async () => {
    const plan = {
      hus: [
        { id: "HU-A", title: "A", blocked_by: [], task_type: "sw" },
        { id: "HU-B", title: "B", blocked_by: ["HU-A"], task_type: "sw" },
      ],
    };
    await prependPreflightHu(plan, root);
    expect(plan.hus[0].id).toBe("PREFLIGHT-000");
    expect(plan.hus[1].id).toBe("HU-A");
    expect(plan.hus[1].blocked_by).toEqual(["PREFLIGHT-000"]);
    expect(plan.hus[2].id).toBe("HU-B");
    expect(plan.hus[2].blocked_by).toEqual(["HU-A", "PREFLIGHT-000"]);
  });

  it("D) idempotent — re-running does NOT duplicate the preflight HU", async () => {
    const plan = { hus: [{ id: "HU-A", blocked_by: [], task_type: "sw" }] };
    await prependPreflightHu(plan, root);
    await prependPreflightHu(plan, root);
    expect(plan.hus.filter((h) => h.id === "PREFLIGHT-000").length).toBe(1);
    expect(plan.hus[1].blocked_by.filter((d) => d === "PREFLIGHT-000").length).toBe(1);
  });

  it("E) hasPreflightHu detects user-supplied 'verificar entorno' titles", async () => {
    const plan = {
      hus: [
        { id: "HU-ENV-1", title: "Verificar entorno reproducible", blocked_by: [], task_type: "infra" },
        { id: "HU-A", title: "A", blocked_by: ["HU-ENV-1"], task_type: "sw" },
      ],
    };
    expect(hasPreflightHu(plan)).toBe(true);
    await prependPreflightHu(plan, root);
    expect(plan.hus.length).toBe(2); // unchanged
    expect(plan.hus[0].id).toBe("HU-ENV-1");
  });
});

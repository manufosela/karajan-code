import { describe, it, expect, vi } from "vitest";
import {
  buildFixerPrompt, applyReviewerFeedback, applyFixerPatch,
} from "../../src/plan/plan-fixer.js";

// KJC-BUG-0045 / P4: self-fix loop after plan-reviewer. The reviewer is
// flag-only; the fixer asks the planner to patch the plan and applies
// it in-process.

const HUS = [
  { id: "hu_001", title: "Setup", scope: "boot", blocked_by: [] },
  { id: "hu_002", title: "Auth", scope: "login", blocked_by: ["hu_001"] },
];
const FINDINGS = {
  missing_hus: [{ spec_section: "5.3", rationale: "audit log not covered" }],
  missing_dependencies: [{ from: "hu_002", on: "hu_001", rationale: "auth needs infra" }],
  scope_overlaps: [{ between: ["hu_001", "hu_002"], rationale: "boot does login too" }],
  order_issues: [], summary: "",
};

describe("buildFixerPrompt", () => {
  it("includes task + findings + output shape + ONLY guard", () => {
    const p = buildFixerPrompt({ task: "Build secure system", hus: HUS, findings: FINDINGS });
    expect(p).toContain("Build secure system");
    expect(p).toContain("5.3");
    expect(p).toContain("audit log not covered");
    expect(p).toContain("hu_002");
    expect(p).toContain("hu_001");
    expect(p).toMatch(/MUST add/i);
    expect(p).toMatch(/MUST declare/i);
    expect(p).toMatch(/MUST drop or merge/i);
    expect(p).toContain('"additions"');
    expect(p).toContain('"deps_to_add"');
    expect(p).toContain('"deletions"');
    expect(p).toMatch(/ONLY|scoped to the report/i);
  });

  it("omits empty findings sections", () => {
    const empty = { missing_hus: [], missing_dependencies: [], scope_overlaps: [], order_issues: [], summary: "" };
    const p = buildFixerPrompt({ task: "x", hus: HUS, findings: empty });
    expect(p).not.toMatch(/### missing_hus/);
    expect(p).not.toMatch(/### missing_dependencies/);
    expect(p).not.toMatch(/### scope_overlaps/);
  });
});

describe("applyReviewerFeedback", () => {
  it("returns { ok: false } on agent failure", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue({ ok: false, error: "boom" }) };
    const r = await applyReviewerFeedback({ agent, task: "t", hus: HUS, findings: FINDINGS });
    expect(r.ok).toBe(false);
  });

  it("returns { ok: false } on non-JSON output", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "plain text" }) };
    const r = await applyReviewerFeedback({ agent, task: "t", hus: HUS, findings: FINDINGS });
    expect(r.ok).toBe(false);
  });

  it("parses well-formed patch and drops malformed additions", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue({
      ok: true,
      output: JSON.stringify({
        additions: [{ id: "BAD" }, { id: "GOOD", description: "Audit log", spec_section: "5.3" }],
        deps_to_add: [{ huId: "hu_002", on: "hu_001" }],
        deletions: ["dup"],
      })
    }) };
    const r = await applyReviewerFeedback({ agent, task: "t", hus: HUS, findings: FINDINGS });
    expect(r.ok).toBe(true);
    expect(r.patch.additions).toHaveLength(1);
    expect(r.patch.additions[0].id).toBe("GOOD");
    expect(r.patch.deps_to_add).toHaveLength(1);
    expect(r.patch.deletions).toEqual(["dup"]);
  });
});

describe("applyFixerPatch", () => {
  const makePlan = () => ({
    planId: "test",
    hus: [
      { id: "hu_001", title: "A", task_type: "sw", status: "pending", blocked_by: [], reuse: [], scope: "a", acceptance_criteria: [], acceptance_tests: [] },
      { id: "hu_002", title: "B", task_type: "sw", status: "pending", blocked_by: ["hu_001"], reuse: [], scope: "b", acceptance_criteria: [], acceptance_tests: [] },
    ],
    updatedAt: "2026-05-11T00:00:00Z",
  });

  // KJC-TSK-0669 (absolute rule): the fix loop ARCHIVES, it never deletes —
  // history survives, refs are cleaned so nothing deadlocks on a skipped HU.
  it("adds new HUs, declares deps without duplicating, archives 'deleted' HUs and cleans refs", () => {
    const plan = makePlan();
    plan.hus.push({ id: "hu_003", title: "C", task_type: "sw", status: "pending", blocked_by: [], reuse: [], scope: "c", acceptance_criteria: [], acceptance_tests: [] });
    const r = applyFixerPatch(plan, {
      additions: [{ description: "Audit log", spec_section: "5.3" }],
      deps_to_add: [
        { huId: "hu_002", on: "hu_001" }, // already present → no duplicate
        { huId: "hu_001", on: "hu_003" }, // new edge
        { huId: "unknown", on: "hu_001" }, // unknown source → ignored
      ],
      deletions: ["hu_002"],
    });
    expect(r).toEqual({ added: 1, depsAdded: 1, archived: 1 });
    expect(plan.hus).toHaveLength(4); // nothing is ever removed
    const archived = plan.hus.find(h => h.id === "hu_002");
    expect(archived.status).toBe("skipped");
    expect(archived.archived_by).toBe("plan-reviewer");
    expect(archived.archive_reason).toMatch(/overlap/);
    expect(plan.hus.find(h => h.id === "hu_001").blocked_by).toEqual(["hu_003"]);
    expect(plan.hus.find(h => h.scope === "Audit log")?.spec_section).toBe("5.3");
  });

  it("archiving cleans dangling blocked_by refs so dependents never deadlock", () => {
    const plan = makePlan();
    applyFixerPatch(plan, { additions: [], deps_to_add: [], deletions: ["hu_001"] });
    expect(plan.hus).toHaveLength(2); // archived, not removed
    expect(plan.hus.find(h => h.id === "hu_001").status).toBe("skipped");
    expect(plan.hus.find(h => h.id === "hu_002").blocked_by).toEqual([]);
  });

  // KJC-BUG-0053: HUs añadidas por fixer deben llevar short_id y blocked_by
  // resueltos desde el id simbólico + dependencies del patch.
  it("addition con id simbólico se persiste como short_id de la HU nueva", () => {
    const plan = makePlan();
    applyFixerPatch(plan, {
      additions: [{ id: "INFRA-NEW", description: "Audit log", spec_section: "5.3" }],
      deps_to_add: [],
      deletions: [],
    });
    const added = plan.hus.find((h) => h.scope === "Audit log");
    expect(added.short_id).toBe("INFRA-NEW");
  });

  it("addition con dependencies simbólicas se resuelve a blocked_by con ids largos de HUs existentes", () => {
    const plan = makePlan();
    plan.hus[0].short_id = "BASE-001"; // hu_001 tiene short_id conocido
    applyFixerPatch(plan, {
      additions: [{ id: "DERIVED-001", description: "Depends on base", dependencies: ["BASE-001"] }],
      deps_to_add: [],
      deletions: [],
    });
    const added = plan.hus.find((h) => h.short_id === "DERIVED-001");
    expect(added.blocked_by).toEqual(["hu_001"]);
  });

  it("dependencies entre 2 additions del mismo patch se resuelven (forward ref)", () => {
    const plan = makePlan();
    applyFixerPatch(plan, {
      additions: [
        { id: "X-001", description: "first" },
        { id: "Y-001", description: "second", dependencies: ["X-001"] },
      ],
      deps_to_add: [],
      deletions: [],
    });
    const x = plan.hus.find((h) => h.short_id === "X-001");
    const y = plan.hus.find((h) => h.short_id === "Y-001");
    expect(y.blocked_by).toEqual([x.id]);
  });

  it("dependencies simbólicas desconocidas se descartan silenciosamente (sin matchear no se añaden)", () => {
    const plan = makePlan();
    applyFixerPatch(plan, {
      additions: [{ id: "DANGLER", description: "orphan ref", dependencies: ["NONEXISTENT-999"] }],
      deps_to_add: [],
      deletions: [],
    });
    const added = plan.hus.find((h) => h.short_id === "DANGLER");
    expect(added.blocked_by).toEqual([]);
  });
});

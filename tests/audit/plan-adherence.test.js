import { describe, it, expect } from "vitest";
import {
  attributeCommitToHu,
  computeCommitAttribution,
  computeAcceptanceTestCoverage,
  computeScopeDiscipline,
  computeDependencyOrder,
  computePlanAdherenceScore,
} from "../../src/audit/plan-adherence.js";

const HUS = [
  { id: "hu_001", title: "Setup project skeleton", scope: "Initialize Node.js project with Express, Vitest, and package json", blocked_by: [], task_type: "infra", acceptance_tests: [{ type: "shell", content: "test -f package.json" }] },
  { id: "hu_002", title: "Add todo store", scope: "In-memory store for todos with CRUD", blocked_by: ["hu_001"], task_type: "sw", acceptance_tests: [{ type: "shell", content: "test -f src/store.js" }] },
  { id: "hu_003", title: "Wire HTTP routes", scope: "Express routes GET/POST/DELETE /todos", blocked_by: ["hu_002"], task_type: "sw", acceptance_tests: [{ type: "shell", content: "curl localhost:3000/todos" }] },
];

const PLAN = { status: "ready", version: 2, hus: HUS };

describe("attributeCommitToHu", () => {
  it("matches by id in the commit message", () => {
    expect(attributeCommitToHu({ message: "feat(hu_002): add store" }, HUS)).toBe("hu_002");
  });

  it("matches by id even when surrounded by punctuation", () => {
    expect(attributeCommitToHu({ message: "[hu_001] init project" }, HUS)).toBe("hu_001");
  });

  it("matches by branch name when message has no id", () => {
    expect(attributeCommitToHu({ message: "wip", branch: "feat/hu_003-wire-http" }, HUS)).toBe("hu_003");
  });

  it("falls back to title slug when neither id nor branch match", () => {
    expect(attributeCommitToHu({ message: "feat: add todo store with CRUD" }, HUS)).toBe("hu_002");
  });

  it("returns null when nothing matches", () => {
    expect(attributeCommitToHu({ message: "random unrelated commit" }, HUS)).toBeNull();
  });

  it("returns null on empty / missing input", () => {
    expect(attributeCommitToHu(null, HUS)).toBeNull();
    expect(attributeCommitToHu({ message: "anything" }, [])).toBeNull();
  });
});

describe("computeCommitAttribution", () => {
  it("returns 100 when every commit references an HU", () => {
    const commits = [
      { message: "chore(hu_001): scaffold" },
      { message: "feat(hu_002): store" },
      { message: "feat(hu_003): routes" },
    ];
    expect(computeCommitAttribution(commits, PLAN)).toBe(100);
  });

  it("returns the proper percentage when some commits are unattributed", () => {
    const commits = [
      { message: "feat(hu_001): scaffold" },
      { message: "chore: tweak gitignore" }, // unattributed
      { message: "feat(hu_002): store" },
      { message: "docs: update readme" },    // unattributed
    ];
    expect(computeCommitAttribution(commits, PLAN)).toBe(50);
  });

  it("returns null on empty commits or empty plan", () => {
    expect(computeCommitAttribution([], PLAN)).toBeNull();
    expect(computeCommitAttribution([{ message: "x" }], { hus: [] })).toBeNull();
  });
});

describe("computeAcceptanceTestCoverage", () => {
  it("returns 100 when every HU with tests has at least one test commit", () => {
    const commits = [
      { message: "test(hu_001): add scaffold acceptance" },
      { message: "test(hu_002): add store acceptance" },
      { message: "test(hu_003): add HTTP routes acceptance" },
    ];
    expect(computeAcceptanceTestCoverage(commits, PLAN)).toBe(100);
  });

  it("returns the partial coverage when only some HUs have test commits", () => {
    const commits = [
      { message: "feat(hu_001): scaffold" },        // no test commit for hu_001
      { message: "test(hu_002): cover store" },     // ✓
      { message: "feat(hu_003): routes" },          // no test commit for hu_003
    ];
    expect(computeAcceptanceTestCoverage(commits, PLAN)).toBe(33);
  });

  it("returns null when the plan declares no acceptance tests", () => {
    const planNoTests = { hus: [{ id: "hu_x", title: "no tests", acceptance_tests: [] }] };
    expect(computeAcceptanceTestCoverage([{ message: "test: x" }], planNoTests)).toBeNull();
  });
});

describe("computeScopeDiscipline", () => {
  it("returns 100 when every changed file matches an HU", () => {
    const files = ["package.json", "src/store.js", "src/routes/todos.js"];
    // package.json matches the 'package' word in scope of hu_001 (no, but its slug doesn't match)
    // Actually package.json wouldn't match unless scope mentions package; let's use better fixtures.
    const planWithFileScopes = {
      hus: [
        { id: "hu_setup", title: "Setup project", scope: "package json initialize" },
        { id: "hu_store", title: "Add store", scope: "store backend" },
        { id: "hu_routes", title: "Wire routes", scope: "routes todos" },
      ],
    };
    expect(computeScopeDiscipline(files, planWithFileScopes)).toBe(100);
  });

  it("flags files that don't match any HU as out-of-scope", () => {
    const files = [
      "src/store.js",                  // matches hu_002 ('store')
      "src/totally-unrelated/x.js",    // out of scope
    ];
    const score = computeScopeDiscipline(files, PLAN);
    expect(score).toBe(50);
  });

  it("returns null on empty files or empty plan", () => {
    expect(computeScopeDiscipline([], PLAN)).toBeNull();
    expect(computeScopeDiscipline(["a.js"], { hus: [] })).toBeNull();
  });
});

describe("computeDependencyOrder", () => {
  it("returns 100 when commits respect every dependency edge", () => {
    const commits = [
      { message: "feat(hu_001): scaffold" },
      { message: "feat(hu_002): store" },
      { message: "feat(hu_003): routes" },
    ];
    expect(computeDependencyOrder(commits, PLAN)).toBe(100);
  });

  it("returns 0 when child commit comes before parent (out-of-order)", () => {
    const commits = [
      { message: "feat(hu_002): store" },     // child first
      { message: "feat(hu_001): scaffold" },  // parent second
    ];
    // edge hu_001 → hu_002. Parent index 1, child index 0 → violated.
    expect(computeDependencyOrder(commits, PLAN)).toBe(0);
  });

  it("returns null when the plan has no dependency edges", () => {
    const planNoDeps = { hus: [{ id: "a", title: "A", blocked_by: [] }] };
    expect(computeDependencyOrder([{ message: "feat(a): x" }], planNoDeps)).toBeNull();
  });

  it("returns null when the commits don't cover any edge endpoint", () => {
    const commits = [{ message: "random" }];
    // edges exist in PLAN but neither parent nor child appears in commits.
    expect(computeDependencyOrder(commits, PLAN)).toBeNull();
  });
});

describe("computePlanAdherenceScore — aggregator", () => {
  it("returns a 100 score on a perfectly-adherent run", () => {
    const commits = [
      { message: "chore(hu_001): scaffold project" },
      { message: "test(hu_001): scaffold acceptance" },
      { message: "feat(hu_002): in-memory todo store" },
      { message: "test(hu_002): store acceptance" },
      { message: "feat(hu_003): wire routes /todos" },
      { message: "test(hu_003): routes acceptance" },
    ];
    const filesChanged = ["package.json", "src/store.js", "src/routes/todos.js"];
    const result = computePlanAdherenceScore({ commits, plan: PLAN, filesChanged });
    expect(result.score).toBe(100);
    expect(result.breakdown.commit_attribution).toBe(100);
    expect(result.breakdown.acceptance_tests).toBe(100);
    expect(result.breakdown.dependency_order).toBe(100);
    expect(result.hu_scores).toHaveLength(3);
    expect(result.hu_scores.every((h) => h.attributed)).toBe(true);
  });

  it("redistributes weight when components return null (run with no plan changes)", () => {
    const result = computePlanAdherenceScore({ commits: [], plan: PLAN, filesChanged: [] });
    // commits empty → attribution null + acceptance_tests has nothing to score
    // → also null. No files → scope null. No commits → deps null.
    // All four nulls → score is null (no data to compute).
    expect(result.score).toBeNull();
  });

  it("flags HUs that received zero commits as 'no commit attributed'", () => {
    const commits = [{ message: "chore(hu_001): scaffold" }];
    const result = computePlanAdherenceScore({ commits, plan: PLAN, filesChanged: [] });
    const huMap = new Map(result.hu_scores.map((h) => [h.huId, h]));
    expect(huMap.get("hu_001").attributed).toBe(true);
    expect(huMap.get("hu_002").attributed).toBe(false);
    expect(huMap.get("hu_002").issues).toContain("no commit attributed");
  });

  it("partial run produces an intermediate score", () => {
    const commits = [
      { message: "chore(hu_001): scaffold" },     // attributed, no test commit for hu_001
      { message: "feat(hu_002): store" },          // attributed
      { message: "docs: update readme" },          // unattributed
    ];
    const filesChanged = ["package.json", "src/store.js"]; // both match
    const result = computePlanAdherenceScore({ commits, plan: PLAN, filesChanged });
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
    // commit_attribution: 2/3 = 67
    expect(result.breakdown.commit_attribution).toBe(67);
  });
});

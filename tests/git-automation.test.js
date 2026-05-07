import { describe, expect, it } from "vitest";
import {
  commitMessageFromTask,
  buildPrBody,
  pendingPathsAreOnlyKarajanScaffold,
  buildFinalizeCommitMessage,
} from "../src/git/automation.js";

describe("commitMessageFromTask", () => {
  it("generates feat: prefix with truncated task", () => {
    const msg = commitMessageFromTask("Add login feature");
    expect(msg).toBe("feat: Add login feature");
  });

  it("truncates task to 72 chars", () => {
    const longTask = "A".repeat(100);
    const msg = commitMessageFromTask(longTask);
    expect(msg).toBe(`feat: ${"A".repeat(72)}`);
  });

  it("collapses whitespace", () => {
    const msg = commitMessageFromTask("Fix   the\n  bug\t here");
    expect(msg).toBe("feat: Fix the bug here");
  });

  it("uses fallback for empty task", () => {
    expect(commitMessageFromTask("")).toBe("feat: karajan update");
    expect(commitMessageFromTask(null)).toBe("feat: karajan update");
    expect(commitMessageFromTask(undefined)).toBe("feat: karajan update");
  });

  // KJC fix(double-commit) — N3-1
  it.each([
    ["doc",       "docs"],
    ["add-tests", "test"],
    ["refactor",  "refactor"],
    ["infra",     "chore"],
    ["sw",        "feat"],
  ])("maps taskType '%s' to '%s:' prefix", (taskType, prefix) => {
    expect(commitMessageFromTask("My task", taskType)).toBe(`${prefix}: My task`);
  });

  it("falls back to 'feat:' when taskType is null/unknown", () => {
    expect(commitMessageFromTask("My task", null)).toBe("feat: My task");
    expect(commitMessageFromTask("My task", "garbage")).toBe("feat: My task");
  });
});

describe("pendingPathsAreOnlyKarajanScaffold (KJC fix N3-1)", () => {
  it("returns false on an empty array", () => {
    expect(pendingPathsAreOnlyKarajanScaffold([])).toBe(false);
  });

  it("returns true when every path is a Karajan internal", () => {
    expect(pendingPathsAreOnlyKarajanScaffold([".gitignore"])).toBe(true);
    expect(pendingPathsAreOnlyKarajanScaffold([".karajan/coder-rules.md"])).toBe(true);
    expect(pendingPathsAreOnlyKarajanScaffold([".reviews/s_2026/summary.md"])).toBe(true);
    expect(pendingPathsAreOnlyKarajanScaffold([
      ".gitignore",
      ".karajan/roles/coder.md",
      ".reviews/s_xx/summary.md",
    ])).toBe(true);
  });

  it("returns false when ANY path is project code", () => {
    expect(pendingPathsAreOnlyKarajanScaffold([".gitignore", "src/index.js"])).toBe(false);
    expect(pendingPathsAreOnlyKarajanScaffold(["package.json"])).toBe(false);
    expect(pendingPathsAreOnlyKarajanScaffold(["src/foo.js", "tests/foo.test.js"])).toBe(false);
  });

  it("does not match a project file that happens to start with .karajan-something", () => {
    // Prefix check is `.karajan/` (with trailing slash) precisely so a
    // sibling like `.karajan-config.yml` is treated as project code.
    expect(pendingPathsAreOnlyKarajanScaffold([".karajan-config.yml"])).toBe(false);
  });
});

describe("buildFinalizeCommitMessage (KJC fix N3-1)", () => {
  it("returns 'chore: scaffold karajan workspace' when only Karajan internals are pending", () => {
    const msg = buildFinalizeCommitMessage({
      task: "Add a JSDoc comment to index.js",
      taskType: "doc",
      pendingPaths: [".gitignore", ".karajan/roles/coder.md"],
    });
    expect(msg).toBe("chore: scaffold karajan workspace");
  });

  it("uses task-driven message when project files are pending", () => {
    const msg = buildFinalizeCommitMessage({
      task: "Add a JSDoc comment to index.js",
      taskType: "doc",
      pendingPaths: ["index.js"],
    });
    expect(msg).toBe("docs: Add a JSDoc comment to index.js");
  });

  it("respects taskType prefix in mixed pending paths (project file present)", () => {
    const msg = buildFinalizeCommitMessage({
      task: "Refactor auth",
      taskType: "refactor",
      pendingPaths: [".gitignore", "src/auth.js"],
    });
    expect(msg).toBe("refactor: Refactor auth");
  });

  it("falls back to feat: when taskType is missing and project files are pending", () => {
    const msg = buildFinalizeCommitMessage({
      task: "Build it",
      taskType: null,
      pendingPaths: ["src/index.js"],
    });
    expect(msg).toBe("feat: Build it");
  });

  it("uses task-driven message when pendingPaths is undefined or empty", () => {
    // Defensive: if we couldn't list pending paths, behave like
    // before this fix (don't accidentally call every commit "scaffold").
    expect(
      buildFinalizeCommitMessage({ task: "Foo", taskType: "doc", pendingPaths: [] }),
    ).toBe("docs: Foo");
    expect(
      buildFinalizeCommitMessage({ task: "Foo", taskType: "doc", pendingPaths: undefined }),
    ).toBe("docs: Foo");
  });
});

describe("buildPrBody", () => {
  it("returns basic body when no stageResults", () => {
    const body = buildPrBody({ task: "Fix bug" });
    expect(body).toContain("Created by Karajan Code.");
    expect(body).not.toContain("## Approach");
    expect(body).not.toContain("## Pending subtasks");
  });

  it("includes approach and steps from planner", () => {
    const body = buildPrBody({
      task: "Add feature",
      stageResults: {
        planner: {
          ok: true,
          approach: "Use factory pattern to create widgets",
          steps: ["Create BaseWidget class", "Add unit tests", "Integrate into orchestrator"]
        }
      }
    });

    expect(body).toContain("## Approach");
    expect(body).toContain("Use factory pattern");
    expect(body).toContain("## Steps");
    expect(body).toContain("1. Create BaseWidget class");
    expect(body).toContain("2. Add unit tests");
    expect(body).toContain("3. Integrate into orchestrator");
  });

  it("includes pending subtasks when triage recommended decomposition", () => {
    const body = buildPrBody({
      task: "Refactor auth system",
      stageResults: {
        triage: {
          shouldDecompose: true,
          subtasks: [
            "Extract auth module into separate service",
            "Update API endpoints to use new auth service",
            "Add integration tests for auth flow"
          ]
        }
      }
    });

    expect(body).toContain("## Pending subtasks");
    expect(body).toContain("- [ ] Update API endpoints");
    expect(body).toContain("- [ ] Add integration tests");
    // First subtask is being worked on, so not listed as pending
    expect(body).not.toContain("- [ ] Extract auth module");
  });

  it("does not include pending subtasks when shouldDecompose is false", () => {
    const body = buildPrBody({
      task: "Fix typo",
      stageResults: {
        triage: {
          shouldDecompose: false,
          subtasks: []
        }
      }
    });

    expect(body).not.toContain("## Pending subtasks");
  });

  it("combines planner approach and decomposition subtasks", () => {
    const body = buildPrBody({
      task: "Big refactor",
      stageResults: {
        planner: {
          ok: true,
          approach: "Extract module first",
          steps: ["Create module", "Add tests"]
        },
        triage: {
          shouldDecompose: true,
          subtasks: ["Extract module", "Update consumers", "Add E2E tests"]
        }
      }
    });

    expect(body).toContain("## Approach");
    expect(body).toContain("## Steps");
    expect(body).toContain("## Pending subtasks");
    expect(body).toContain("- [ ] Update consumers");
    expect(body).toContain("- [ ] Add E2E tests");
  });

  it("handles single subtask without pending section", () => {
    const body = buildPrBody({
      task: "Small task",
      stageResults: {
        triage: {
          shouldDecompose: true,
          subtasks: ["Only one subtask"]
        }
      }
    });

    // Only 1 subtask = the current one, no pending
    expect(body).not.toContain("## Pending subtasks");
  });
});

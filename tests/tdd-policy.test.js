import { describe, expect, it } from "vitest";
import { evaluateTddPolicy } from "../src/review/tdd-policy.js";

describe("evaluateTddPolicy", () => {
  it("fails when source changes exist without test changes", () => {
    const diff = [
      "diff --git a/src/auth.js b/src/auth.js",
      "index 111..222 100644",
      "--- a/src/auth.js",
      "+++ b/src/auth.js"
    ].join("\n");

    const out = evaluateTddPolicy(diff, { methodology: "tdd", require_test_changes: true });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("source_changes_without_tests");
  });

  it("passes when source and test files change", () => {
    const diff = [
      "diff --git a/src/auth.js b/src/auth.js",
      "index 111..222 100644",
      "--- a/src/auth.js",
      "+++ b/src/auth.js",
      "diff --git a/tests/auth.test.js b/tests/auth.test.js",
      "index 111..222 100644",
      "--- a/tests/auth.test.js",
      "+++ b/tests/auth.test.js"
    ].join("\n");

    const out = evaluateTddPolicy(diff, { methodology: "tdd", require_test_changes: true });
    expect(out.ok).toBe(true);
    expect(out.reason).toBe("tests_present");
  });

  it("passes when no source files changed", () => {
    const diff = [
      "diff --git a/README.md b/README.md",
      "index 111..222 100644",
      "--- a/README.md",
      "+++ b/README.md"
    ].join("\n");

    const out = evaluateTddPolicy(diff, { methodology: "tdd", require_test_changes: true });
    expect(out.ok).toBe(true);
    expect(out.reason).toBe("no_source_changes");
  });

  describe("taskType skip", () => {
    const diff = [
      "diff --git a/src/auth.js b/src/auth.js",
      "index 111..222 100644",
      "--- a/src/auth.js",
      "+++ b/src/auth.js"
    ].join("\n");

    it("skips TDD for doc taskType", () => {
      const out = evaluateTddPolicy(diff, { require_test_changes: true }, [], "doc");
      expect(out.ok).toBe(true);
      expect(out.reason).toBe("tdd_not_applicable_for_task_type");
    });

    it("skips TDD for infra taskType", () => {
      const out = evaluateTddPolicy(diff, { require_test_changes: true }, [], "infra");
      expect(out.ok).toBe(true);
      expect(out.reason).toBe("tdd_not_applicable_for_task_type");
    });

    it("does NOT skip TDD for sw taskType", () => {
      const out = evaluateTddPolicy(diff, { require_test_changes: true }, [], "sw");
      expect(out.ok).toBe(false);
      expect(out.reason).toBe("source_changes_without_tests");
    });

    it("does NOT skip TDD when taskType is null", () => {
      const out = evaluateTddPolicy(diff, { require_test_changes: true }, [], null);
      expect(out.ok).toBe(false);
      expect(out.reason).toBe("source_changes_without_tests");
    });

    it("does NOT skip TDD for refactor taskType", () => {
      const out = evaluateTddPolicy(diff, { require_test_changes: true }, [], "refactor");
      expect(out.ok).toBe(false);
      expect(out.reason).toBe("source_changes_without_tests");
    });
  });

  describe("untracked files support", () => {
    it("passes when source is only in diff but tests are untracked (new files)", () => {
      const diff = [
        "diff --git a/src/config.js b/src/config.js",
        "index 111..222 100644",
        "--- a/src/config.js",
        "+++ b/src/config.js"
      ].join("\n");

      const untrackedFiles = [
        "src/guards/policy-resolver.js",
        "tests/guards/policy-resolver.test.js"
      ];

      const out = evaluateTddPolicy(diff, { require_test_changes: true }, untrackedFiles);
      expect(out.ok).toBe(true);
      expect(out.reason).toBe("tests_present");
      expect(out.testFiles).toContain("tests/guards/policy-resolver.test.js");
      expect(out.sourceFiles).toContain("src/guards/policy-resolver.js");
    });

    it("fails when untracked files are all source with no tests", () => {
      const diff = "";
      const untrackedFiles = [
        "src/guards/policy-resolver.js",
        "src/guards/utils.js"
      ];

      const out = evaluateTddPolicy(diff, { require_test_changes: true }, untrackedFiles);
      expect(out.ok).toBe(false);
      expect(out.reason).toBe("source_changes_without_tests");
    });

    it("passes when all untracked files are tests (add-tests scenario)", () => {
      const diff = "";
      const untrackedFiles = [
        "tests/guards/policy-resolver.test.js",
        "tests/guards/utils.test.js"
      ];

      const out = evaluateTddPolicy(diff, { require_test_changes: true }, untrackedFiles);
      expect(out.ok).toBe(true);
      expect(out.reason).toBe("no_source_changes");
    });

    it("merges diff files and untracked files without duplicates", () => {
      const diff = [
        "diff --git a/src/config.js b/src/config.js",
        "index 111..222 100644",
        "--- a/src/config.js",
        "+++ b/src/config.js"
      ].join("\n");

      const untrackedFiles = [
        "src/config.js",
        "tests/config.test.js"
      ];

      const out = evaluateTddPolicy(diff, { require_test_changes: true }, untrackedFiles);
      expect(out.ok).toBe(true);
      expect(out.sourceFiles.filter(f => f === "src/config.js")).toHaveLength(1);
    });

    it("handles empty/undefined untrackedFiles gracefully", () => {
      const diff = [
        "diff --git a/src/auth.js b/src/auth.js",
        "index 111..222 100644",
        "--- a/src/auth.js",
        "+++ b/src/auth.js"
      ].join("\n");

      const out1 = evaluateTddPolicy(diff, { require_test_changes: true }, []);
      expect(out1.ok).toBe(false);

      const out2 = evaluateTddPolicy(diff, { require_test_changes: true }, undefined);
      expect(out2.ok).toBe(false);
    });
  });
});

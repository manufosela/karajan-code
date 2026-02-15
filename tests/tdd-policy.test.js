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
});

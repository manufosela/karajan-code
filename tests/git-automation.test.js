import { describe, expect, it } from "vitest";
import { commitMessageFromTask } from "../src/git/automation.js";

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
});

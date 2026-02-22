import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

const { runCommand } = await import("../src/utils/process.js");
const { generateDiff } = await import("../src/review/diff-generator.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateDiff", () => {
  it("builds diff against base ref including uncommitted workspace changes", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "diff --git ...", stderr: "" });

    await generateDiff({ baseRef: "abc123" });

    expect(runCommand).toHaveBeenCalledWith("git", ["diff", "abc123"]);
  });
});

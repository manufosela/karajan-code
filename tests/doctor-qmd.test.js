import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({ runCommand: vi.fn() }));

describe("doctor QMD check", () => {
  let getQmdChecks, runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ runCommand } = await import("../src/utils/process.js"));
    ({ getQmdChecks } = await import("../src/checks/qmd.js"));
  });

  it("reports OK with version when qmd is found", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "qmd 2.5.3\n", stderr: "" });
    const [check] = getQmdChecks();
    const result = await check.detect();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("qmd 2.5.3");
    expect(result.detail).toContain("semantic wiki active");
  });

  it.each([
    ["non-zero exit", { exitCode: 1, stdout: "", stderr: "not found" }, null],
    ["throws", null, new Error("command not found")],
  ])("reports MISS with install command when qmd %s", async (_label, resolveValue, rejectError) => {
    if (rejectError) runCommand.mockRejectedValue(rejectError);
    else runCommand.mockResolvedValue(resolveValue);
    const [check] = getQmdChecks();
    const result = await check.detect();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Not found");
    expect(result.fix).toContain("Install:");
  });
});

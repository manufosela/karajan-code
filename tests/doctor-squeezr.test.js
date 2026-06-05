import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({ runCommand: vi.fn() }));

describe("doctor Squeezr check", () => {
  let getSqueezrChecks, runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ runCommand } = await import("../src/utils/process.js"));
    ({ getSqueezrChecks } = await import("../src/checks/squeezr.js"));
  });

  it("reports OK with version when squeezr is found", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "squeezr 1.46.3\n", stderr: "" });
    const [check] = getSqueezrChecks();
    const result = await check.detect();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("squeezr 1.46.3");
    expect(result.detail).toContain("context compression active");
  });

  it.each([
    ["non-zero exit", { exitCode: 1, stdout: "", stderr: "not found" }, null],
    ["throws", null, new Error("command not found")],
  ])("reports MISS with install command when squeezr %s", async (_label, resolveValue, rejectError) => {
    if (rejectError) runCommand.mockRejectedValue(rejectError);
    else runCommand.mockResolvedValue(resolveValue);
    const [check] = getSqueezrChecks();
    const result = await check.detect();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Not found");
    expect(result.fix).toContain("Install:");
  });
});

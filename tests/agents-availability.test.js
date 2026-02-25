import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => name)
}));

describe("agents/availability", () => {
  let runCommand;

  beforeEach(async () => {
    vi.resetAllMocks();
    const proc = await import("../src/utils/process.js");
    runCommand = proc.runCommand;
  });

  it("does not throw when all agents are available", async () => {
    runCommand.mockResolvedValue({ exitCode: 0 });
    const { assertAgentsAvailable } = await import("../src/agents/availability.js");
    await expect(assertAgentsAvailable(["claude", "codex"])).resolves.toBeUndefined();
  });

  it("throws with descriptive error when agent is missing", async () => {
    runCommand.mockResolvedValue({ exitCode: 1 });
    const { assertAgentsAvailable } = await import("../src/agents/availability.js");

    await expect(assertAgentsAvailable(["claude"])).rejects.toThrow(/Missing required AI CLIs/);
  });

  it("includes install URL in error message", async () => {
    runCommand.mockResolvedValue({ exitCode: 1 });
    const { assertAgentsAvailable } = await import("../src/agents/availability.js");

    try {
      await assertAgentsAvailable(["codex"]);
    } catch (e) {
      expect(e.message).toContain("codex");
      expect(e.message).toContain("Install:");
    }
  });

  it("deduplicates agent names", async () => {
    runCommand.mockResolvedValue({ exitCode: 0 });
    const { assertAgentsAvailable } = await import("../src/agents/availability.js");
    await assertAgentsAvailable(["claude", "claude", "claude"]);

    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("skips null and undefined entries", async () => {
    runCommand.mockResolvedValue({ exitCode: 0 });
    const { assertAgentsAvailable } = await import("../src/agents/availability.js");
    await assertAgentsAvailable([null, undefined, "claude"]);

    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("skips unknown agent names gracefully", async () => {
    runCommand.mockResolvedValue({ exitCode: 0 });
    const { assertAgentsAvailable } = await import("../src/agents/availability.js");
    await expect(assertAgentsAvailable(["unknown-agent"])).resolves.toBeUndefined();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("reports multiple missing agents", async () => {
    runCommand.mockResolvedValue({ exitCode: 1 });
    const { assertAgentsAvailable } = await import("../src/agents/availability.js");

    try {
      await assertAgentsAvailable(["claude", "codex"]);
    } catch (e) {
      expect(e.message).toContain("claude");
      expect(e.message).toContain("codex");
    }
  });

  it("does not throw for empty array", async () => {
    const { assertAgentsAvailable } = await import("../src/agents/availability.js");
    await expect(assertAgentsAvailable([])).resolves.toBeUndefined();
    expect(runCommand).not.toHaveBeenCalled();
  });
});

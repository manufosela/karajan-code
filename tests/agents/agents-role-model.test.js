import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" })
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => name)
}));

describe("agents role model handling", () => {
  let runCommand;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ runCommand } = await import("../src/utils/process.js"));
  });

  it("passes role model to GeminiAgent runTask and reviewTask", async () => {
    const { GeminiAgent } = await import("../src/agents/gemini-agent.js");

    const config = {
      session: { max_iteration_minutes: 1 },
      roles: {
        planner: { model: "gemini-plan-model" },
        reviewer: { model: "gemini-review-model" }
      }
    };

    const agent = new GeminiAgent("gemini", config, {});
    await agent.runTask({ prompt: "plan", role: "planner" });
    await agent.reviewTask({ prompt: "review", role: "reviewer" });

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "gemini",
      ["-p", "plan", "--model", "gemini-plan-model"],
      expect.any(Object)
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "gemini",
      ["-p", "review", "--output-format", "json", "--model", "gemini-review-model"],
      expect.any(Object)
    );
  });

  it("passes role model to AiderAgent runTask and reviewTask", async () => {
    const { AiderAgent } = await import("../src/agents/aider-agent.js");

    const config = {
      session: { max_iteration_minutes: 1 },
      roles: {
        refactorer: { model: "aider-refactor-model" },
        reviewer: { model: "aider-review-model" }
      }
    };

    const agent = new AiderAgent("aider", config, {});
    await agent.runTask({ prompt: "refactor", role: "refactorer" });
    await agent.reviewTask({ prompt: "review", role: "reviewer" });

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "aider",
      ["--yes", "--message", "refactor", "--model", "aider-refactor-model"],
      expect.any(Object)
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "aider",
      ["--yes", "--message", "review", "--model", "aider-review-model"],
      expect.any(Object)
    );
  });
});

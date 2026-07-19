// KJC-BUG-0112: without an `origin` remote (quickstart: fresh folder +
// git init), push/PR automation must SKIP with an info line — the old
// behavior threw on `git fetch origin` and escalated to Solomon on every
// iteration, burning the run's budget on an expected condition.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/session/store.js", () => ({ addCheckpoint: vi.fn(async () => {}) }));

const { setRunner } = await import("../src/utils/git.js");
const { finalizeGitAutomation } = await import("../src/git/automation.js");

afterEach(() => setRunner(null));

function noRemoteRunner(calls) {
  return vi.fn(async (_cmd, args) => {
    calls.push(args.join(" "));
    if (args[0] === "remote") return { exitCode: 1, stdout: "", stderr: "fatal: No such remote 'origin'" };
    if (args[0] === "status") return { exitCode: 0, stdout: "", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  });
}

describe("finalizeGitAutomation without a remote (KJC-BUG-0112)", () => {
  it("skips fetch/push/PR with an info line instead of throwing", async () => {
    const calls = [];
    setRunner(noRemoteRunner(calls));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await finalizeGitAutomation({
      config: { git: { auto_commit: false, auto_push: true, auto_pr: true } },
      gitCtx: { enabled: true, branch: "feat/x", baseBranch: "main", autoRebase: true },
      task: "quickstart tic-tac-toe",
      logger,
      session: {},
    });

    expect(result).toBeDefined();
    expect(calls.some((c) => c.startsWith("fetch"))).toBe(false);
    expect(calls.some((c) => c.startsWith("push"))).toBe(false);
    expect(logger.info.mock.calls.flat().join(" ")).toContain("No remote configured");
  });
});

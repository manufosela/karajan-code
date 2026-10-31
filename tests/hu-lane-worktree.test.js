// PAR-E2 (KJC-TSK-0629) PR1: worktree lanes aim git + coder prompt at the
// lane directory. Covers the cwd plumbing in utils/git (the CoderRole
// override cases went with the retired pipeline, KJC-TSK-1338).
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitAll, hasChanges, pushBranch, setRunner } from "../src/utils/git.js";

describe("utils/git cwd plumbing (PAR-E2)", () => {
  afterEach(() => setRunner(null));

  function captureRunner() {
    return vi.fn(async (_cmd, args) => {
      if (args[0] === "status") return { exitCode: 0, stdout: " M file.js", stderr: "" };
      if (args[0] === "log") return { exitCode: 0, stdout: "abc123\x1ffeat: x", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });
  }

  it("hasChanges runs git in the given cwd", async () => {
    const runner = captureRunner();
    setRunner(runner);
    await hasChanges("/wt/HU-001");
    expect(runner).toHaveBeenCalledWith("git", ["status", "--porcelain"], { cwd: "/wt/HU-001" });
  });

  it("commitAll threads cwd through add, status, commit and log", async () => {
    const runner = captureRunner();
    setRunner(runner);
    const res = await commitAll("feat: x", "/wt/HU-001");
    expect(res.committed).toBe(true);
    for (const call of runner.mock.calls) {
      expect(call[2]).toEqual({ cwd: "/wt/HU-001" });
    }
  });

  it("pushBranch runs git push in the given cwd", async () => {
    const runner = captureRunner();
    setRunner(runner);
    await pushBranch("kj-hu-HU-001", "/wt/HU-001");
    // KJC-TSK-1093: no -u — inside the host sandbox .git/config is read-only.
    expect(runner).toHaveBeenCalledWith("git", ["push", "origin", "kj-hu-HU-001"], { cwd: "/wt/HU-001" });
  });

  it("omitting cwd keeps the legacy behavior (no cwd option)", async () => {
    const runner = captureRunner();
    setRunner(runner);
    await hasChanges();
    expect(runner.mock.calls[0][2]).toEqual({});
  });
});

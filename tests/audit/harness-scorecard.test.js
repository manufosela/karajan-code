// KJC-TSK-0470 — Bootstrap Docker de ai-harness-scorecard (manager).
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/process.js", () => ({ runCommand: vi.fn() }));
import { runCommand } from "../../src/utils/process.js";
import {
  normalizeHarnessConfig, isDockerAvailable, isHarnessImagePresent,
  ensureHarnessImage, runHarnessAssess,
} from "../../src/audit/harness-scorecard.js";

const IMG = "markmishaev76/ai-harness-scorecard:latest";
const mockExit = (...calls) => calls.forEach(([exitCode, stdout = "", stderr = ""]) =>
  runCommand.mockResolvedValueOnce({ exitCode, stdout, stderr }));

describe("audit/harness-scorecard — KJC-TSK-0470", () => {
  beforeEach(() => runCommand.mockReset());

  it("normalizeHarnessConfig fills defaults + honours overrides", () => {
    expect(normalizeHarnessConfig({})).toMatchObject({ enabled: true, image: IMG, pullTimeoutMs: 300000, assessTimeoutMs: 180000 });
    expect(normalizeHarnessConfig({ enabled: false, image: "x:y", pull_timeout_ms: 1000 }))
      .toMatchObject({ enabled: false, image: "x:y", pullTimeoutMs: 1000 });
  });

  it("isDockerAvailable + isHarnessImagePresent reflect docker output", async () => {
    mockExit([0, "25"], [1, "", "no daemon"]);
    expect(await isDockerAvailable()).toBe(true);
    expect(await isDockerAvailable()).toBe(false);
    mockExit([0, "sha256:abc\n"], [0, ""]);
    expect(await isHarnessImagePresent(IMG)).toBe(true);
    expect(await isHarnessImagePresent(IMG)).toBe(false);
  });

  it("ensureHarnessImage: cache hit / pull success / pull failure", async () => {
    mockExit([0, "sha256:abc\n"]);
    expect(await ensureHarnessImage({})).toMatchObject({ pulled: false, reused: true });
    mockExit([0, ""], [0, "Pulled"]);
    expect(await ensureHarnessImage({})).toMatchObject({ pulled: true, reused: false });
    expect(runCommand).toHaveBeenLastCalledWith("docker", expect.arrayContaining(["pull", IMG]), expect.any(Object));
    mockExit([0, ""], [1, "", "auth required"]);
    expect(await ensureHarnessImage({})).toMatchObject({ pulled: false, error: expect.stringMatching(/auth required/) });
  });

  it("runHarnessAssess mounts repo read-only, parses JSON, surfaces failures", async () => {
    mockExit([0, JSON.stringify({ overall_score: 78, grade: "B" })]);
    const ok = await runHarnessAssess("/tmp/repo", {});
    expect(ok).toMatchObject({ ok: true, score: 78, grade: "B" });
    expect(runCommand.mock.calls[0][1]).toEqual(expect.arrayContaining(["run", "--rm", "-v", "/tmp/repo:/repo:ro"]));
    mockExit([2, "", "boom"]);
    expect(await runHarnessAssess("/tmp/repo", {})).toMatchObject({ ok: false, error: expect.stringMatching(/boom/) });
  });
});

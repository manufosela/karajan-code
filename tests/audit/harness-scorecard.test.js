// KJC-TSK-0470 — Bootstrap Docker de ai-harness-scorecard (manager).
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/process.js", () => ({ runCommand: vi.fn() }));
import { runCommand } from "../../src/utils/process.js";
import {
  normalizeHarnessConfig, isDockerAvailable, isHarnessImagePresent,
  ensureHarnessImage, runHarnessAssess,
  classifyDockerFailure, hintForReason,
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
    // success path: docker version + docker images -q (cache hit) + docker run
    mockExit([0, "25"], [0, "sha256:abc\n"], [0, JSON.stringify({ overall_score: 78, grade: "B" })]);
    const ok = await runHarnessAssess("/tmp/repo", {});
    expect(ok).toMatchObject({ ok: true, score: 78, grade: "B" });
    expect(runCommand.mock.calls.at(-1)[1]).toEqual(expect.arrayContaining(["run", "--rm", "-v", "/tmp/repo:/repo:ro"]));
    // failure path during assess: surface stderr + classified reason
    mockExit([0, "25"], [0, "sha256:abc\n"], [2, "", "boom"]);
    expect(await runHarnessAssess("/tmp/repo", {})).toMatchObject({ ok: false, error: expect.stringMatching(/boom/), reason: "unknown" });
  });

  it("classifyDockerFailure maps known stderr patterns + falls back to unknown — KJC-BUG-0077", () => {
    expect(classifyDockerFailure("Error response from daemon: pull access denied for foo/bar")).toBe("image_inaccessible");
    expect(classifyDockerFailure("repository does not exist or may require 'docker login'")).toBe("image_inaccessible");
    expect(classifyDockerFailure("denied: requested access to the resource is denied")).toBe("image_inaccessible");
    expect(classifyDockerFailure("unauthorized: authentication required")).toBe("auth_required");
    expect(classifyDockerFailure("dial tcp: lookup registry-1.docker.io: no such host")).toBe("network_error");
    expect(classifyDockerFailure("net/http: TLS handshake timeout")).toBe("network_error");
    expect(classifyDockerFailure("something totally unexpected")).toBe("unknown");
    expect(classifyDockerFailure()).toBe("unknown");
  });

  it("hintForReason returns actionable suggestion per reason — KJC-BUG-0077", () => {
    expect(hintForReason("image_inaccessible", IMG)).toMatch(/--no-harness/);
    expect(hintForReason("image_inaccessible", IMG)).toContain(IMG);
    expect(hintForReason("auth_required", IMG)).toMatch(/docker login/);
    expect(hintForReason("network_error", IMG)).toMatch(/Network/i);
    expect(hintForReason("docker_missing", IMG)).toMatch(/Install Docker/);
    expect(hintForReason("invalid_json", IMG)).toBeNull();
    expect(hintForReason("unknown", IMG)).toBeNull();
  });

  it("runHarnessAssess surfaces docker_missing with hint — KJC-BUG-0077", async () => {
    mockExit([1, "", "no daemon"]);
    const r = await runHarnessAssess("/tmp/repo", {});
    expect(r).toMatchObject({ ok: false, reason: "docker_missing", hint: expect.stringMatching(/Install Docker/) });
  });

  it("runHarnessAssess surfaces image_inaccessible with hint when pull denied — KJC-BUG-0077", async () => {
    // docker version OK, image not cached, pull denied
    mockExit(
      [0, "25"],
      [0, ""],
      [1, "", "Error response from daemon: pull access denied for markmishaev76/ai-harness-scorecard"],
    );
    const r = await runHarnessAssess("/tmp/repo", {});
    expect(r).toMatchObject({
      ok: false,
      reason: "image_inaccessible",
      error: expect.stringMatching(/pull access denied/),
      hint: expect.stringMatching(/--no-harness/),
    });
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/session-store.js", () => ({
  loadMostRecentSession: vi.fn()
}));

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

import { loadMostRecentSession } from "../src/session-store.js";
import { runCommand } from "../src/utils/process.js";
import { undoCommand } from "../src/commands/undo.js";

describe("kj undo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("finds most recent session and resets soft by default", async () => {
    loadMostRecentSession.mockResolvedValue({
      id: "s_2026-03-31T10-00-00-000Z",
      session_start_sha: "abc1234567890def"
    });
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "commit", stderr: "" }) // cat-file
      .mockResolvedValueOnce({ exitCode: 0, stdout: "def5678 some commit\n", stderr: "" }) // log
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }); // reset

    const result = await undoCommand({});

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("soft");
    expect(result.sha).toBe("abc1234567890def");
    expect(runCommand).toHaveBeenCalledWith("git", ["reset", "--soft", "abc1234567890def"]);
  });

  it("uses --hard when hard flag is set", async () => {
    loadMostRecentSession.mockResolvedValue({
      id: "s_2026-03-31T10-00-00-000Z",
      session_start_sha: "abc1234567890def"
    });
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "commit", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "def5678 some commit\n", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    const result = await undoCommand({ hard: true });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("hard");
    expect(runCommand).toHaveBeenCalledWith("git", ["reset", "--hard", "abc1234567890def"]);
  });

  it("returns error when no session found", async () => {
    loadMostRecentSession.mockResolvedValue(null);

    const result = await undoCommand({});

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No session to undo/);
  });

  it("returns error when session has no session_start_sha", async () => {
    loadMostRecentSession.mockResolvedValue({
      id: "s_2026-03-31T10-00-00-000Z",
      status: "done"
    });

    const result = await undoCommand({});

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no session_start_sha/);
  });

  it("returns error when HEAD is already at the SHA (no commits to undo)", async () => {
    loadMostRecentSession.mockResolvedValue({
      id: "s_2026-03-31T10-00-00-000Z",
      session_start_sha: "abc1234567890def"
    });
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "commit", stderr: "" }) // cat-file
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }); // log (empty = no commits after)

    const result = await undoCommand({});

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No commits to undo/);
  });

  it("returns error when SHA not found in git history", async () => {
    loadMostRecentSession.mockResolvedValue({
      id: "s_2026-03-31T10-00-00-000Z",
      session_start_sha: "deadbeef12345678"
    });
    runCommand.mockResolvedValueOnce({ exitCode: 128, stdout: "", stderr: "fatal: Not a valid object name" });

    const result = await undoCommand({});

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found in git history/i);
  });

  it("returns sessionId in successful result", async () => {
    loadMostRecentSession.mockResolvedValue({
      id: "s_2026-03-31T12-00-00-000Z",
      session_start_sha: "f00baaaa11112222"
    });
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "commit", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "aaa1111 fix something\n", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    const result = await undoCommand({});

    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe("s_2026-03-31T12-00-00-000Z");
    expect(result.message).toContain("f00baaaa");
  });
});

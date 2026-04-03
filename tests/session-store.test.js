import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";

vi.mock("../src/utils/paths.js", () => ({
  getSessionRoot: () => "/tmp/test-sessions"
}));

vi.mock("../src/utils/fs.js", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn()
}));

// Dynamic import so mocks are set up first
const { createSession, saveSession, loadSession, addCheckpoint, markSessionStatus, pauseSession, resumeSessionWithAnswer, loadMostRecentSession } = await import("../src/session-store.js");
const { exists } = await import("../src/utils/fs.js");

describe("session-store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
  });

  // ── createSession ─────────────────────────────────────────────

  describe("createSession", () => {
    it("creates a session with generated ID when none is provided", async () => {
      const session = await createSession();

      expect(session.id).toMatch(/^s_\d{4}-\d{2}-\d{2}T/);
      expect(session.status).toBe("running");
      expect(session.checkpoints).toEqual([]);
      expect(session.created_at).toBeTruthy();
      expect(session.updated_at).toBeTruthy();
    });

    it("uses the provided ID when initial.id is set", async () => {
      const session = await createSession({ id: "s_custom-id" });

      expect(session.id).toBe("s_custom-id");
    });

    it("merges initial data into the session", async () => {
      const session = await createSession({ id: "s_merge", task: "do stuff", mode: "paranoid" });

      expect(session.task).toBe("do stuff");
      expect(session.mode).toBe("paranoid");
      expect(session.status).toBe("running");
    });

    it("initial fields override defaults (except id)", async () => {
      const session = await createSession({ id: "s_override", status: "paused", checkpoints: [{ x: 1 }] });

      expect(session.status).toBe("paused");
      expect(session.checkpoints).toEqual([{ x: 1 }]);
    });

    it("writes session.json to disk", async () => {
      await createSession({ id: "s_disk-check" });

      expect(fs.writeFile).toHaveBeenCalledWith(
        "/tmp/test-sessions/s_disk-check/session.json",
        expect.any(String),
        "utf8"
      );
    });

    it("generates unique IDs for consecutive calls", async () => {
      const s1 = await createSession();
      // Tiny delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 2));
      const s2 = await createSession();

      expect(s1.id).not.toBe(s2.id);
    });
  });

  // ── saveSession ───────────────────────────────────────────────

  describe("saveSession", () => {
    it("writes JSON to the correct path", async () => {
      const session = { id: "s_save-test", status: "running", checkpoints: [] };

      await saveSession(session);

      expect(fs.writeFile).toHaveBeenCalledWith(
        "/tmp/test-sessions/s_save-test/session.json",
        expect.any(String),
        "utf8"
      );
    });

    it("updates updated_at timestamp", async () => {
      const session = { id: "s_ts", status: "running", checkpoints: [], updated_at: "old" };

      await saveSession(session);

      expect(session.updated_at).not.toBe("old");
      // Should be a valid ISO date
      expect(new Date(session.updated_at).toISOString()).toBe(session.updated_at);
    });

    it("serializes session as pretty JSON", async () => {
      const session = { id: "s_pretty", status: "running", checkpoints: [] };

      await saveSession(session);

      const written = fs.writeFile.mock.calls[0][1];
      expect(written).toContain("\n");
      const parsed = JSON.parse(written);
      expect(parsed.id).toBe("s_pretty");
    });
  });

  // ── loadSession ───────────────────────────────────────────────

  describe("loadSession", () => {
    it("loads and parses session from disk", async () => {
      const stored = { id: "s_load", status: "running", checkpoints: [] };
      exists.mockResolvedValue(true);
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(stored));

      const session = await loadSession("s_load");

      expect(session).toEqual(stored);
    });

    it("throws when session file does not exist", async () => {
      exists.mockResolvedValue(false);

      await expect(loadSession("s_missing")).rejects.toThrow("Session not found: s_missing");
    });

    it("throws on malformed JSON", async () => {
      exists.mockResolvedValue(true);
      vi.spyOn(fs, "readFile").mockResolvedValue("not json {{{");

      await expect(loadSession("s_bad-json")).rejects.toThrow();
    });
  });

  // ── addCheckpoint ─────────────────────────────────────────────

  describe("addCheckpoint", () => {
    it("appends a checkpoint with timestamp", async () => {
      const session = { id: "s_cp", status: "running", checkpoints: [] };

      await addCheckpoint(session, { stage: "code", iteration: 1 });

      expect(session.checkpoints).toHaveLength(1);
      expect(session.checkpoints[0].stage).toBe("code");
      expect(session.checkpoints[0].iteration).toBe(1);
      expect(session.checkpoints[0].at).toBeTruthy();
    });

    it("preserves existing checkpoints", async () => {
      const session = {
        id: "s_cp2",
        status: "running",
        checkpoints: [{ at: "2026-01-01T00:00:00.000Z", stage: "plan" }]
      };

      await addCheckpoint(session, { stage: "code" });

      expect(session.checkpoints).toHaveLength(2);
      expect(session.checkpoints[0].stage).toBe("plan");
      expect(session.checkpoints[1].stage).toBe("code");
    });

    it("saves the session after adding checkpoint", async () => {
      const session = { id: "s_cp3", status: "running", checkpoints: [] };

      await addCheckpoint(session, { info: "test" });

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  // ── markSessionStatus ─────────────────────────────────────────

  describe("markSessionStatus", () => {
    it("updates the status field", async () => {
      const session = { id: "s_mark", status: "running", checkpoints: [] };

      await markSessionStatus(session, "done");

      expect(session.status).toBe("done");
    });

    it("saves the session after status change", async () => {
      const session = { id: "s_mark2", status: "running", checkpoints: [] };

      await markSessionStatus(session, "failed");

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  // ── pauseSession ──────────────────────────────────────────────

  describe("pauseSession", () => {
    it("sets status to paused and stores paused_state", async () => {
      const session = { id: "s_pause", status: "running", checkpoints: [] };

      await pauseSession(session, { question: "Proceed?", context: { iter: 3 } });

      expect(session.status).toBe("paused");
      expect(session.paused_state.question).toBe("Proceed?");
      expect(session.paused_state.context).toEqual({ iter: 3 });
      expect(session.paused_state.paused_at).toBeTruthy();
    });
  });

  // ── resumeSessionWithAnswer ───────────────────────────────────

  describe("resumeSessionWithAnswer", () => {
    it("resumes a paused session with the answer", async () => {
      const stored = {
        id: "s_resume",
        status: "paused",
        checkpoints: [],
        paused_state: { question: "Next?", context: {}, paused_at: "2026-01-01T00:00:00.000Z" }
      };
      exists.mockResolvedValue(true);
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(stored));

      const session = await resumeSessionWithAnswer("s_resume", "Go ahead");

      expect(session.status).toBe("running");
      expect(session.paused_state.answer).toBe("Go ahead");
      expect(session.paused_state.resumed_at).toBeTruthy();
    });

    it("allows resuming a failed session", async () => {
      const stored = {
        id: "s_failed",
        status: "failed",
        checkpoints: [],
        paused_state: { question: "Retry?", context: {}, paused_at: "2026-01-01T00:00:00.000Z" }
      };
      exists.mockResolvedValue(true);
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(stored));

      const session = await resumeSessionWithAnswer("s_failed", "yes");
      expect(session.status).toBe("running");
    });

    it("allows resuming a stopped session", async () => {
      const stored = {
        id: "s_stopped",
        status: "stopped",
        checkpoints: [],
        paused_state: { question: "Continue?", context: {}, paused_at: "2026-01-01T00:00:00.000Z" }
      };
      exists.mockResolvedValue(true);
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(stored));

      const session = await resumeSessionWithAnswer("s_stopped", "yes");
      expect(session.status).toBe("running");
    });

    it("throws for non-resumable status (e.g. approved)", async () => {
      const stored = {
        id: "s_done",
        status: "approved",
        checkpoints: []
      };
      exists.mockResolvedValue(true);
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(stored));

      await expect(resumeSessionWithAnswer("s_done", "x")).rejects.toThrow("cannot be resumed");
    });

    it("throws when session has no paused_state", async () => {
      const stored = {
        id: "s_no-state",
        status: "paused",
        checkpoints: []
      };
      exists.mockResolvedValue(true);
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(stored));

      await expect(resumeSessionWithAnswer("s_no-state", "x")).rejects.toThrow("no paused state");
    });
  });

  // ── loadMostRecentSession ─────────────────────────────────────

  describe("loadMostRecentSession", () => {
    it("returns null when session root does not exist", async () => {
      vi.spyOn(fs, "readdir").mockRejectedValue(new Error("ENOENT"));

      const result = await loadMostRecentSession();
      expect(result).toBeNull();
    });

    it("returns null when there are no session directories", async () => {
      vi.spyOn(fs, "readdir").mockResolvedValue([]);

      const result = await loadMostRecentSession();
      expect(result).toBeNull();
    });

    it("loads the most recent session (last alphabetically)", async () => {
      const dirs = [
        { name: "s_2026-01-01T00-00-00-000Z", isDirectory: () => true },
        { name: "s_2026-01-02T00-00-00-000Z", isDirectory: () => true }
      ];
      vi.spyOn(fs, "readdir").mockResolvedValue(dirs);
      exists.mockResolvedValue(true);

      const latest = { id: "s_2026-01-02T00-00-00-000Z", status: "running", checkpoints: [] };
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(latest));

      const result = await loadMostRecentSession();
      expect(result.id).toBe("s_2026-01-02T00-00-00-000Z");
    });

    it("skips malformed sessions and returns the next valid one", async () => {
      const dirs = [
        { name: "s_old", isDirectory: () => true },
        { name: "s_newest", isDirectory: () => true }
      ];
      vi.spyOn(fs, "readdir").mockResolvedValue(dirs);

      // s_newest fails, s_old succeeds
      const valid = { id: "s_old", status: "done", checkpoints: [] };
      exists.mockImplementation(async (path) => {
        if (path.includes("s_newest")) return false;
        return true;
      });
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(valid));

      const result = await loadMostRecentSession();
      expect(result.id).toBe("s_old");
    });

    it("filters out non-directory entries", async () => {
      const entries = [
        { name: "readme.txt", isDirectory: () => false },
        { name: "s_valid", isDirectory: () => true }
      ];
      vi.spyOn(fs, "readdir").mockResolvedValue(entries);
      exists.mockResolvedValue(true);

      const session = { id: "s_valid", status: "running", checkpoints: [] };
      vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(session));

      const result = await loadMostRecentSession();
      expect(result.id).toBe("s_valid");
    });
  });
});

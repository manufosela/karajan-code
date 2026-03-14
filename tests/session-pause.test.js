import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { pauseSession, resumeSessionWithAnswer } from "../src/session-store.js";

vi.mock("../src/utils/paths.js", () => ({
  getSessionRoot: () => "/tmp/test-sessions"
}));

vi.mock("../src/utils/fs.js", () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(true)
}));

describe("pauseSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
  });

  it("sets session status to paused and stores paused_state", async () => {
    const session = {
      id: "s_test-pause",
      status: "running",
      checkpoints: []
    };

    await pauseSession(session, {
      question: "What should I do?",
      context: { iteration: 2, stage: "tdd" }
    });

    expect(session.status).toBe("paused");
    expect(session.paused_state).toBeDefined();
    expect(session.paused_state.question).toBe("What should I do?");
    expect(session.paused_state.context.iteration).toBe(2);
    expect(session.paused_state.paused_at).toBeTruthy();
  });
});

describe("resumeSessionWithAnswer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
  });

  it("resumes a paused session with answer", async () => {
    const pausedSession = {
      id: "s_test-resume",
      status: "paused",
      checkpoints: [],
      paused_state: {
        question: "How to proceed?",
        context: { iteration: 1 },
        paused_at: "2026-02-17T10:00:00.000Z"
      }
    };

    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(pausedSession));

    const session = await resumeSessionWithAnswer("s_test-resume", "Continue with option A");

    expect(session.status).toBe("running");
    expect(session.paused_state.answer).toBe("Continue with option A");
    expect(session.paused_state.resumed_at).toBeTruthy();
  });

  it("throws if session is not paused", async () => {
    const approvedSession = {
      id: "s_not-resumable",
      status: "approved",
      checkpoints: []
    };

    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(approvedSession));

    await expect(resumeSessionWithAnswer("s_not-resumable", "answer")).rejects.toThrow("cannot be resumed");
  });

  it("throws if session has no paused state", async () => {
    const brokenSession = {
      id: "s_no-state",
      status: "paused",
      checkpoints: []
    };

    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(brokenSession));

    await expect(resumeSessionWithAnswer("s_no-state", "answer")).rejects.toThrow("no paused state");
  });
});

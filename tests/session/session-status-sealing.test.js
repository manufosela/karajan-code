import { describe, it, expect, vi, beforeEach } from "vitest";

// We exercise the boundary guard directly. The mocks isolate
// markSessionStatus so the test doesn't need a real session-store.
vi.mock("../src/session/store.js", () => ({
  markSessionStatus: vi.fn(),
  saveSession: vi.fn(),
  loadSession: vi.fn(),
  resumeSessionWithAnswer: vi.fn(),
  resetAllRetryCounters: vi.fn(),
  setStatus: vi.fn(),
  setReviewerFeedback: vi.fn(),
  setSonarIssueSignature: vi.fn(),
  setSonarRepeatCount: vi.fn(),
  setReviewerIssueSignature: vi.fn(),
  setReviewerRepeatCount: vi.fn(),
  setBudget: vi.fn(),
}));

const { sealSessionStatusIfStillRunning } = await import("../src/orchestrator/flow-runner.js");
const { markSessionStatus } = await import("../src/session/store.js");

describe("sealSessionStatusIfStillRunning (KJC-BUG-0037)", () => {
  beforeEach(() => vi.clearAllMocks());

  // ---- happy paths ---------------------------------------------------------

  it("seals as 'approved' when result.approved is true and session is still running", async () => {
    const session = { id: "s1", status: "running" };
    await sealSessionStatusIfStillRunning(session, { approved: true });
    expect(markSessionStatus).toHaveBeenCalledWith(session, "approved");
  });

  it("seals as 'paused' when result.paused is true", async () => {
    const session = { id: "s1", status: "running" };
    await sealSessionStatusIfStillRunning(session, { paused: true });
    expect(markSessionStatus).toHaveBeenCalledWith(session, "paused");
  });

  it("seals as 'cancelled' when result.cancelled is true", async () => {
    const session = { id: "s1", status: "running" };
    await sealSessionStatusIfStillRunning(session, { cancelled: true });
    expect(markSessionStatus).toHaveBeenCalledWith(session, "cancelled");
  });

  // ---- failure / fallback paths ---------------------------------------------

  it("seals as 'failed' when result is undefined / has no recognised flag", async () => {
    const session = { id: "s1", status: "running" };
    await sealSessionStatusIfStillRunning(session);
    expect(markSessionStatus).toHaveBeenCalledWith(session, "failed");
  });

  it("seals as 'failed' on result.approved=false (the explicit-fail return shape)", async () => {
    const session = { id: "s1", status: "running" };
    await sealSessionStatusIfStillRunning(session, { approved: false, reason: "stage_error" });
    expect(markSessionStatus).toHaveBeenCalledWith(session, "failed");
  });

  it("also seals when status is missing entirely (defensive)", async () => {
    const session = { id: "s1" }; // no status key
    await sealSessionStatusIfStillRunning(session, { approved: true });
    expect(markSessionStatus).toHaveBeenCalledWith(session, "approved");
  });

  // ---- idempotence: do NOT overwrite a real terminal status -----------------

  it("does NOT overwrite when session.status is already 'approved'", async () => {
    const session = { id: "s1", status: "approved" };
    await sealSessionStatusIfStillRunning(session, { approved: true });
    expect(markSessionStatus).not.toHaveBeenCalled();
  });

  it("does NOT overwrite when session.status is already 'failed'", async () => {
    const session = { id: "s1", status: "failed" };
    await sealSessionStatusIfStillRunning(session, { approved: true });
    expect(markSessionStatus).not.toHaveBeenCalled();
  });

  it("does NOT overwrite when session.status is 'paused'", async () => {
    const session = { id: "s1", status: "paused" };
    await sealSessionStatusIfStillRunning(session, { approved: true });
    expect(markSessionStatus).not.toHaveBeenCalled();
  });

  it("does NOT overwrite when session.status is 'cancelled'", async () => {
    const session = { id: "s1", status: "cancelled" };
    await sealSessionStatusIfStillRunning(session);
    expect(markSessionStatus).not.toHaveBeenCalled();
  });

  // ---- never-throws contract ------------------------------------------------

  it("never throws when markSessionStatus rejects (non-blocking)", async () => {
    markSessionStatus.mockRejectedValueOnce(new Error("disk full"));
    const session = { id: "s1", status: "running" };
    await expect(sealSessionStatusIfStillRunning(session, { approved: true })).resolves.toBeUndefined();
  });

  it("never throws when session is null/undefined", async () => {
    await expect(sealSessionStatusIfStillRunning(null, { approved: true })).resolves.toBeUndefined();
    await expect(sealSessionStatusIfStillRunning(undefined, { approved: true })).resolves.toBeUndefined();
    expect(markSessionStatus).not.toHaveBeenCalled();
  });
});

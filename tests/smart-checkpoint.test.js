import { describe, expect, it } from "vitest";
import { shouldAutoContinueCheckpoint } from "../src/orchestrator.js";

describe("shouldAutoContinueCheckpoint", () => {
  it("auto-continues when progress is detected", () => {
    const session = { standby_retry_count: 0, _checkpoint_stall_count: 2 };
    const result = shouldAutoContinueCheckpoint(session, true);
    expect(result.autoContinue).toBe(true);
    expect(result.reason).toBe("progress_detected");
    expect(session._checkpoint_stall_count).toBe(0);
  });

  it("auto-continues when stall was caused by rate limit (1st stall)", () => {
    const session = { standby_retry_count: 2, _checkpoint_stall_count: 0 };
    const result = shouldAutoContinueCheckpoint(session, false);
    expect(result.autoContinue).toBe(true);
    expect(result.reason).toBe("recoverable_stall");
    expect(session._checkpoint_stall_count).toBe(1);
  });

  it("auto-continues on 2nd consecutive rate-limit stall", () => {
    const session = { standby_retry_count: 1, _checkpoint_stall_count: 1 };
    const result = shouldAutoContinueCheckpoint(session, false);
    expect(result.autoContinue).toBe(true);
    expect(result.reason).toBe("recoverable_stall");
    expect(session._checkpoint_stall_count).toBe(2);
  });

  it("asks user on 3rd consecutive stall even with rate limit", () => {
    const session = { standby_retry_count: 1, _checkpoint_stall_count: 2 };
    const result = shouldAutoContinueCheckpoint(session, false);
    expect(result.autoContinue).toBe(false);
    expect(result.reason).toBe("max_stalls_reached");
  });

  it("asks user when no progress and no rate limit", () => {
    const session = { standby_retry_count: 0, _checkpoint_stall_count: 0 };
    const result = shouldAutoContinueCheckpoint(session, false);
    expect(result.autoContinue).toBe(false);
    expect(result.reason).toBe("no_progress");
  });

  it("resets stall counter when progress resumes", () => {
    const session = { standby_retry_count: 0, _checkpoint_stall_count: 5 };
    shouldAutoContinueCheckpoint(session, true);
    expect(session._checkpoint_stall_count).toBe(0);
    // Next stall without rate limit should ask
    const result = shouldAutoContinueCheckpoint(session, false);
    expect(result.autoContinue).toBe(false);
  });

  it("handles missing session fields gracefully", () => {
    const session = {};
    const result = shouldAutoContinueCheckpoint(session, false);
    expect(result.autoContinue).toBe(false);
    expect(result.reason).toBe("no_progress");
  });
});

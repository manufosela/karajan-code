// HU-4878 (KJC-BUG-0659): an explicit unknown sessionId is still an error, not a "no session report" case.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let sessionRoot;
vi.mock("../../src/utils/paths.js", async (orig) => ({ ...(await orig()), getSessionRoot: () => sessionRoot }));
vi.mock("../../src/report/review-truth.js", () => ({
  reviewTruthReport: async () => ({ verdicts: 0 }),
  formatReviewTruth: () => [],
}));

describe("kj report with an unknown explicit sessionId (HU-4878)", () => {
  let tmp;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-report-unknown-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("throws Session not found when the sessions directory is empty", async () => {
    sessionRoot = path.join(tmp, "empty");
    await fs.mkdir(sessionRoot);
    const { reportCommand } = await import("../../src/commands/report.js");
    await expect(reportCommand({ sessionId: "missing-id" })).rejects.toThrow("Session not found: missing-id");
  });

  it("throws Session not found when the sessions directory does not exist", async () => {
    sessionRoot = path.join(tmp, "missing");
    const { reportCommand } = await import("../../src/commands/report.js");
    await expect(reportCommand({ sessionId: "missing-id" })).rejects.toThrow("Session not found: missing-id");
    expect(console.log).not.toHaveBeenCalled();
  });
});

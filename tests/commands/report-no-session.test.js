// HU-4878 (KJC-BUG-0659): with no session report (kj 5 has no kj run sessions), kj report says so
// in one line and still prints the project blocks, the Cross-AI review truth among them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let sessionRoot;
vi.mock("../../src/utils/paths.js", async (orig) => ({ ...(await orig()), getSessionRoot: () => sessionRoot }));
vi.mock("../../src/report/review-truth.js", () => ({
  reviewTruthReport: async () => ({ verdicts: 3 }),
  formatReviewTruth: () => ["Cross-AI review truth", "  codex: 3 findings"],
}));

describe("kj report with no session report (HU-4878)", () => {
  let tmp;
  let logs;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kj-report-none-"));
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("prints the review truth block when the sessions directory does not exist", async () => {
    sessionRoot = path.join(tmp, "missing");
    const { reportCommand } = await import("../../src/commands/report.js");
    await reportCommand({});
    const out = logs.join("\n");
    expect(out).toContain("No session report");
    expect(out).toContain("Cross-AI review truth");
  });

  it("prints the review truth block when the sessions directory is empty", async () => {
    sessionRoot = path.join(tmp, "empty");
    await fs.mkdir(sessionRoot);
    const { reportCommand } = await import("../../src/commands/report.js");
    await reportCommand({});
    expect(logs.join("\n")).toContain("Cross-AI review truth");
  });

  it("with --format json and no session prints one valid JSON document and no text blocks", async () => {
    for (const dir of ["missing", "empty-json"]) {
      logs = [];
      sessionRoot = path.join(tmp, dir);
      if (dir === "empty-json") await fs.mkdir(sessionRoot);
      const { reportCommand } = await import("../../src/commands/report.js");
      await reportCommand({ format: "json" });
      expect(logs).toHaveLength(1);
      const out = logs.join("\n");
      expect(out).not.toContain("Cross-AI review truth");
      expect(JSON.parse(out)).toEqual({ session: null, reason: "no session report" });
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeSessionJournal } from "../../src/session/journal/write-all.js";

// KJC-BUG-0084 — the shared journal writer must produce summary.md for
// every terminal ending, not just the approved path. Pre-fix, a run that
// died on sonar_repeat or a gh pr failure left only triage.md behind.

const logger = { info: vi.fn(), warn: vi.fn() };

function makeSession(journalDir) {
  return {
    id: "s_test",
    task: "test task",
    _journalDir: journalDir,
    _journalFiles: ["triage.md"],
    _journalIterations: [],
    _startedAt: Date.now() - 60_000,
    session_start_sha: null,
    head_at_start: null,
  };
}

describe("session/journal/write-all (KJC-BUG-0084)", () => {
  let tmpDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-write-all-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes summary.md with the failure badge and the budget breakdown", async () => {
    const session = makeSession(tmpDir);
    const res = await writeSessionJournal({
      session,
      logger,
      result: "STOPPED",
      iterations: 2,
      budget: {
        total_cost_usd: 0.53,
        total_tokens: 11075,
        breakdown_by_role: { coder: { tokens_in: 4046, tokens_out: 7000, cached_tokens: 1287936, cost_usd: 0.53 } },
      },
      stages: { sonar: { ok: false, summary: "quality gate ERROR repeated" } },
      commits: [],
    });

    expect(res.written).toBe(true);
    expect(session._journalWritten).toBe(true);
    const summary = await fs.readFile(path.join(tmpDir, "summary.md"), "utf8");
    expect(summary).toContain("STOPPED");
    expect(summary).toContain("sonar");
  });

  it("returns written:false without throwing when the session has no journal dir", async () => {
    const res = await writeSessionJournal({ session: { id: "s" }, logger, result: "FAILED" });
    expect(res.written).toBe(false);
    expect(res.reason).toBe("no journal dir");
  });

  it("never throws when the journal dir is not writable", async () => {
    // Point _journalDir at a regular FILE so the writes inside fail. The
    // sub-writers are individually fault-tolerant (they warn and continue),
    // so the contract asserted here is the one flow-runner's finally relies
    // on: the call RESOLVES — a journal failure never masks the run result.
    const fileAsDir = path.join(tmpDir, "not-a-dir");
    await fs.writeFile(fileAsDir, "plain file");
    const session = makeSession(fileAsDir);
    await expect(
      writeSessionJournal({ session, logger, result: "FAILED" })
    ).resolves.toBeTruthy();
    expect(logger.warn).toHaveBeenCalled();
  });
});

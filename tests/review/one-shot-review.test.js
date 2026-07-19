// ENV-B1 (KJC-TSK-0637): the cross-AI rule is the core of the v4 review —
// the reviewer must NEVER be the host agent, and no cross reviewer means
// error (a silent same-AI fallback would defeat the whole gate).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickCrossReviewer, runOneShotReview } from "../../src/review/one-shot-review.js";
import { loadVerdict, diffHash } from "../../src/review/verdict-store.js";

const DIFF = "diff --git a/x.js b/x.js\n+const ok = true;\n";
const agentsUp = (...names) => async () => names.map((name) => ({ name, available: true }));

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-osr-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("pickCrossReviewer", () => {
  it("keeps the configured reviewer when it differs from the host", async () => {
    const config = { roles: { reviewer: { provider: "codex" } } };
    expect(await pickCrossReviewer({ config, hostAgent: "claude" })).toBe("codex");
  });

  it("overrides a configured reviewer that IS the host", async () => {
    const config = { roles: { reviewer: { provider: "claude" } } };
    const picked = await pickCrossReviewer({ config, hostAgent: "claude", detectAgents: agentsUp("claude", "codex") });
    expect(picked).toBe("codex");
  });

  it("returns null when only the host agent exists", async () => {
    const config = { roles: {} };
    expect(await pickCrossReviewer({ config, hostAgent: "claude", detectAgents: agentsUp("claude") })).toBeNull();
  });
});

describe("runOneShotReview", () => {
  const config = { roles: { reviewer: { provider: "codex" } } };
  const reviewOutput = (approved, issues = []) => JSON.stringify({
    approved, blocking_issues: issues, non_blocking_suggestions: [], summary: "s", confidence: 0.9,
  });

  function fakeAgent(output) {
    return { reviewTask: vi.fn().mockResolvedValue({ ok: true, output }) };
  }

  it("stores an approved verdict tied to the diff hash", async () => {
    const agent = fakeAgent(reviewOutput(true));
    const record = await runOneShotReview({
      diff: DIFF, config, projectDir: dir, hostAgent: "claude",
      createAgentFn: () => agent, detectAgents: agentsUp("claude", "codex"),
    });
    expect(record.verdict).toBe("approved");
    expect(record.reviewer).toBe("codex");
    expect(record.diffHash).toBe(diffHash(DIFF));
    expect(await loadVerdict(dir, record.diffHash)).toBeTruthy();
    expect(agent.reviewTask).toHaveBeenCalledOnce();
  });

  it("stores a rejected verdict with the blocking issues", async () => {
    const record = await runOneShotReview({
      diff: DIFF, config, projectDir: dir, hostAgent: "claude",
      createAgentFn: () => fakeAgent(reviewOutput(false, [{ id: "I1", severity: "high" }])),
    });
    expect(record.verdict).toBe("rejected");
    expect(record.issues).toHaveLength(1);
  });

  it("throws (never silently falls back) when no cross-AI reviewer exists", async () => {
    await expect(runOneShotReview({
      diff: DIFF, config: { roles: {} }, projectDir: dir, hostAgent: "claude",
      detectAgents: agentsUp("claude"),
    })).rejects.toThrow(/cross-AI review requires an agent other than the host/);
  });

  it("throws on an empty diff", async () => {
    await expect(runOneShotReview({ diff: "", config, projectDir: dir, hostAgent: "claude" }))
      .rejects.toThrow(/nothing to review/);
  });
});

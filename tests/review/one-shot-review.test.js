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

  // HU-4990: no agent reviews its own work, the panel coder (kj code) included.
  const panel = (coder, reviewer) => ({ roles: { coder: { provider: coder }, reviewer: { provider: reviewer } } });

  it("overrides a configured reviewer that is the panel coder, and says so", async () => {
    const logger = { warn: vi.fn() };
    const picked = await pickCrossReviewer({
      config: panel("codex", "codex"), hostAgent: "claude", logger, detectAgents: agentsUp("codex", "claude", "gemini"),
    });
    expect(picked).toBe("gemini");
    expect(logger.warn).toHaveBeenCalledWith("⚠ reviewer codex is also the panel coder: kj uses gemini so no agent reviews its own work");
  });

  it("keeps a reviewer that is neither host nor coder, with no notice", async () => {
    const logger = { warn: vi.fn() };
    expect(await pickCrossReviewer({ config: panel("claude", "codex"), hostAgent: "claude", logger })).toBe("codex");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns null when only the host and the coder exist, and the error says what to do", async () => {
    const config = panel("codex", "codex");
    const detectAgents = agentsUp("codex", "claude");
    expect(await pickCrossReviewer({ config, hostAgent: "claude", detectAgents })).toBeNull();
    await expect(runOneShotReview({ diff: DIFF, config, projectDir: dir, hostAgent: "claude", detectAgents })).rejects.toThrow(
      "cross-AI review needs an agent other than the host (claude) and the panel coder (codex): install another supported CLI (codex, claude, gemini, opencode, aider) or set roles.reviewer.provider to one",
    );
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

  // HU-4833: the schema is checked by default; reviewer_options.require_schema: false keeps the old path.
  it("refuses a verdict that breaks its schema unless require_schema is false", async () => {
    const broken = reviewOutput(false, [{ id: "R-1", severity: "urgent", category: "correctness", file: "x.js", line: 1, description: "d", suggested_fix: "f" }]);
    const run = (cfg) => runOneShotReview({
      diff: DIFF, config: cfg, projectDir: dir, hostAgent: "claude",
      createAgentFn: () => fakeAgent(broken), detectAgents: agentsUp("claude", "codex"),
    });
    await expect(run(config)).rejects.toThrow(/blocking_issues\[0\]\.severity/);
    const record = await run({ ...config, reviewer_options: { require_schema: false } });
    expect(record.verdict).toBe("rejected");
  });

  it("keeps checking the schema when require_schema is true", async () => {
    const broken = reviewOutput(false, [{ id: "R-1", severity: "urgent", category: "correctness", file: "x.js", line: 1, description: "d", suggested_fix: "f" }]);
    await expect(runOneShotReview({
      diff: DIFF, config: { ...config, reviewer_options: { require_schema: true } }, projectDir: dir, hostAgent: "claude",
      createAgentFn: () => fakeAgent(broken), detectAgents: agentsUp("claude", "codex"),
    })).rejects.toThrow(/breaks its schema/);
  });

  // KJC-TSK-1380 (#3207): the reviewer starts from facts computed without a model, kept in the verdict.
  it("hands the reviewer the diff's facts and keeps them in the verdict", async () => {
    const agent = fakeAgent(reviewOutput(true));
    const record = await runOneShotReview({
      diff: DIFF, config, projectDir: dir, hostAgent: "claude",
      createAgentFn: () => agent, detectAgents: agentsUp("claude", "codex"),
    });
    expect(agent.reviewTask.mock.calls[0][0].prompt).toMatch(/Verified facts \(computed without a model\)[\s\S]*x\.js \+1 \/ -0/);
    expect(record.facts).toContainEqual(expect.objectContaining({ kind: "no-tests" }));
  });

  // KJC-TSK-0838: the sonar block is persisted with the verdict, so the
  // pre-commit check can refuse a diff that was reviewed but never analysed.
  it("persists the sonar block it is handed, bound to the same diff hash", async () => {
    const sonar = { ran: true, projectKey: "k", covered: ["x.js"], uncovered: [], blocking: 0, advisory: 0 };
    const record = await runOneShotReview({
      diff: DIFF, config, projectDir: dir, hostAgent: "claude", sonar,
      createAgentFn: () => fakeAgent(reviewOutput(true)), detectAgents: agentsUp("claude", "codex"),
    });
    expect((await loadVerdict(dir, record.diffHash)).sonar).toEqual(sonar);
  });

  it("stores a rejected verdict with the blocking issues", async () => {
    const record = await runOneShotReview({
      diff: DIFF, config, projectDir: dir, hostAgent: "claude",
      createAgentFn: () => fakeAgent(reviewOutput(false, [{ id: "I1", severity: "high", category: "correctness", file: null, line: null, description: "d", suggested_fix: "f" }])),
    });
    expect(record.verdict).toBe("rejected");
    expect(record.issues).toHaveLength(1);
  });

  // KJC-BUG-0357 (#2151): claude answers with its whole stream-json event stream;
  // the first JSON is a hook event, the verdict lives in the assistant and result events.
  it("reads the verdict from a stream-json event stream that starts with hook events", async () => {
    const verdict = reviewOutput(true);
    const stream = [
      { type: "system", subtype: "hook_started", hook_name: "SessionStart" },
      { type: "system", subtype: "init", session_id: "s" },
      { type: "assistant", message: { content: [{ type: "text", text: verdict }] } },
      { type: "result", subtype: "success", result: verdict },
    ].map((e) => JSON.stringify(e)).join("\n");
    const record = await runOneShotReview({
      diff: DIFF, config: { roles: { reviewer: { provider: "claude" } } }, projectDir: dir, hostAgent: null,
      createAgentFn: () => fakeAgent(stream), detectAgents: agentsUp("claude"),
    });
    expect(record).toMatchObject({ verdict: "approved", reviewer: "claude", summary: "s" });
  });

  it("throws (never silently falls back) when no cross-AI reviewer exists", async () => {
    await expect(runOneShotReview({
      diff: DIFF, config: { roles: {} }, projectDir: dir, hostAgent: "claude",
      detectAgents: agentsUp("claude"),
    })).rejects.toThrow(/cross-AI review requires an agent other than the host/);
  });

  // detectHostAgent() answers null outside a host: the message must never read "(null)".
  it("names the host unknown when there is none", async () => {
    await expect(runOneShotReview({
      diff: DIFF, config: { roles: {} }, projectDir: dir, hostAgent: null, detectAgents: agentsUp(),
    })).rejects.toThrow("cross-AI review requires an agent other than the host (unknown)");
  });

  it("throws on an empty diff", async () => {
    await expect(runOneShotReview({ diff: "", config, projectDir: dir, hostAgent: "claude" }))
      .rejects.toThrow(/nothing to review/);
  });
});

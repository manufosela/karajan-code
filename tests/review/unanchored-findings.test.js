// HU-4837 (KJC-TSK-1731, épica KJC-PCS-0113): kj review --staged anchors every blocking finding
// (anchorFinding) before it reaches the coder or blocks a commit. What does not hold is kept apart,
// never deleted in silence; a rejection made only of it is asked again once; kj never approves.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOneShotReview } from "../../src/review/one-shot-review.js";

const DIFF = [
  "diff --git a/src/a.js b/src/a.js",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "+const b = eval(input);",
  " export { a };",
  "",
].join("\n");
const agentsUp = (...names) => async () => names.map((name) => ({ name, available: true }));
const config = { roles: { reviewer: { provider: "codex" } } };

const finding = (over) => ({ id: "R-1", severity: "high", category: "correctness", file: "src/a.js", line: 2, description: "`eval(input)` runs untrusted code", suggested_fix: "parse it", ...over });
const REAL = finding({ id: "R-1" });
const GHOST = finding({ id: "R-2", file: "src/ghost.js", line: 9, description: "`ghost()` leaks" });
const SECURITY_GHOST = finding({ id: "R-3", category: "security", file: "src/ghost.js", line: 9, description: "token leak" });
const answer = (approved, issues) => ({ ok: true, output: JSON.stringify({ approved, blocking_issues: issues, non_blocking_suggestions: [], summary: "s", confidence: 0.9 }) });

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-unanchored-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), "const a = 1;\nconst b = eval(input);\nexport { a };\n");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const review = (agent) => runOneShotReview({ diff: DIFF, config, projectDir: dir, hostAgent: "claude", createAgentFn: () => agent, detectAgents: agentsUp("claude", "codex") });

describe("unanchored findings in kj review --staged", () => {
  it("keeps only anchored findings as blocking and the rest apart, each with its reason", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValue(answer(false, [REAL, GHOST])) };
    const record = await review(agent);
    expect(record.verdict).toBe("rejected");
    expect(record.issues.map((i) => i.id)).toEqual(["R-1"]);
    expect(record.unanchored).toEqual([expect.objectContaining({ id: "R-2", reason: "missing-file" })]);
    expect(agent.reviewTask).toHaveBeenCalledOnce();
  });

  it("asks the reviewer again once, naming the unanchored findings, when a rejection holds only them", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValueOnce(answer(false, [GHOST])).mockResolvedValueOnce(answer(false, [REAL])) };
    const record = await review(agent);
    expect(agent.reviewTask).toHaveBeenCalledTimes(2);
    expect(agent.reviewTask.mock.calls[1][0].prompt).toMatch(/R-2[\s\S]*missing-file/);
    expect(record.verdict).toBe("rejected");
    expect(record.issues.map((i) => i.id)).toEqual(["R-1"]);
  });

  it("a second rejection made only of unanchored findings stays rejected as unanchored-only, never approved", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValue(answer(false, [GHOST])) };
    const record = await review(agent);
    expect(agent.reviewTask).toHaveBeenCalledTimes(2);
    expect(record.verdict).toBe("rejected");
    expect(record.reason).toBe("unanchored-only");
    expect(record.unanchored.map((i) => i.id)).toEqual(["R-2"]);
  });

  it("the second answer decides: an approval after the question again is the reviewer's own approval", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValueOnce(answer(false, [GHOST])).mockResolvedValueOnce(answer(true, [])) };
    const record = await review(agent);
    expect(record.verdict).toBe("approved");
    expect(record.reviewer).toBe("codex");
  });

  it("a protected finding (security or critical) that does not anchor stays blocking, marked unanchored", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValue(answer(false, [SECURITY_GHOST])) };
    const record = await review(agent);
    expect(agent.reviewTask).toHaveBeenCalledOnce();
    expect(record.verdict).toBe("rejected");
    expect(record.issues).toEqual([expect.objectContaining({ id: "R-3", unanchored: "missing-file" })]);
  });

  // The question asked again is a review like the first: out of quota, it fails over the same way.
  const QUOTA = { ok: false, error: "You've hit your usage limit. Upgrade or try again later." };
  const reviewWith = (agents, { acted = [], warns = [], models = [], cfg = config } = {}) => runOneShotReview({
    diff: DIFF, config: cfg, projectDir: dir, hostAgent: "claude", logger: { info: () => {}, warn: (m) => warns.push(m) },
    createAgentFn: (name, c) => { models.push([name, c?.roles?.reviewer?.model]); return agents[name]; },
    detectAgents: agentsUp("claude", ...Object.keys(agents)),
    candidateStatusFn: async () => Object.keys(agents).map((name) => ({ name, installed: true, authenticated: true })),
    recordActive: (entry) => acted.push(entry),
  });

  it("a reviewer out of quota on the question asked again fails over to the next one, recorded as the reviewer", async () => {
    const agents = {
      codex: { reviewTask: vi.fn().mockResolvedValueOnce(answer(false, [GHOST])).mockResolvedValueOnce(QUOTA) },
      copilot: { reviewTask: vi.fn().mockResolvedValue(answer(false, [REAL])) },
    };
    const acted = [];
    const record = await reviewWith(agents, { acted });
    expect(agents.copilot.reviewTask).toHaveBeenCalledOnce();
    expect(agents.copilot.reviewTask.mock.calls[0][0].prompt).toMatch(/R-2[\s\S]*missing-file/);
    expect(record.reviewer).toBe("copilot");
    expect(acted.at(-1)).toEqual({ role: "reviewer", declared: "codex", acting: "copilot" });
    expect(record.issues.map((i) => i.id)).toEqual(["R-1"]);
  });

  it("asked again from a fallback out of quota, the failover skips the declared reviewer already out of it", async () => {
    const agents = {
      codex: { reviewTask: vi.fn().mockResolvedValue(QUOTA) },
      copilot: { reviewTask: vi.fn().mockResolvedValueOnce(answer(false, [GHOST])).mockResolvedValueOnce(QUOTA) },
      gemini: { reviewTask: vi.fn().mockResolvedValue(answer(false, [REAL])) },
    };
    const warns = [];
    const models = [];
    const record = await reviewWith(agents, { warns, models, cfg: { roles: { reviewer: { provider: "codex", model: "gpt-5.4-mini" } } } });
    expect(agents.codex.reviewTask).toHaveBeenCalledOnce();
    expect(record.reviewer).toBe("gemini");
    expect(warns.at(-1)).toMatch(/copilot sin cuota → usando gemini[\s\S]*next review tries codex again/);
    // The declared reviewer's model pin never reaches a fallback, asked again included.
    expect(models).toEqual([["codex", "gpt-5.4-mini"], ["copilot", null], ["copilot", null], ["gemini", null]]);
  });

  it("a rejection with no findings at all is not unanchored-only and is not asked again", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValue(answer(false, [])) };
    const record = await review(agent);
    expect(agent.reviewTask).toHaveBeenCalledOnce();
    expect(record.verdict).toBe("rejected");
    expect(record.reason).toBeUndefined();
  });

  // HU-4845: kj report tells a measured rejection from one saved before the anchoring by this field.
  it("a rejection whose findings all anchor still carries unanchored: [], so it counts as measured", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValue(answer(false, [REAL])) };
    const record = await review(agent);
    expect(record.unanchored).toEqual([]);
  });

  it("an approval is stored as it comes: nothing to anchor", async () => {
    const agent = { reviewTask: vi.fn().mockResolvedValue(answer(true, [])) };
    const record = await review(agent);
    expect(record.verdict).toBe("approved");
    expect(record.unanchored ?? []).toEqual([]);
    expect(agent.reviewTask).toHaveBeenCalledOnce();
  });
});

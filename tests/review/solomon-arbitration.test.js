// AB-E (KJC-TSK-0651): when brain and reviewer clash, a THIRD AI arbitrates.
// Hard rules under test: the arbiter is never the brain nor the reviewer
// (2-agent machines get an actionable error, never self-arbitration), an
// approve ruling opens the gate for the exact diff, and security issues
// are NEVER overridable — the agent is not even consulted.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickThirdParty, runSolomonArbitration } from "../../src/review/solomon-arbitration.js";
import { saveVerdict, checkVerdict } from "../../src/review/verdict-store.js";

const DIFF = "diff --git a/x.js b/x.js\n+const ok = true;\n";
const agentsUp = (...names) => async () => names.map((name) => ({ name, available: true }));

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sol-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("pickThirdParty", () => {
  it("prefers the configured solomon when it differs from brain AND reviewer", async () => {
    const config = { roles: { solomon: { provider: "gemini" } } };
    expect(await pickThirdParty({ config, hostAgent: "claude", reviewerAgent: "codex", detectAgents: agentsUp("claude", "codex", "gemini") })).toBe("gemini");
  });

  it("overrides a configured solomon that matches brain or reviewer", async () => {
    const config = { roles: { solomon: { provider: "codex" } } };
    expect(await pickThirdParty({ config, hostAgent: "claude", reviewerAgent: "codex", detectAgents: agentsUp("claude", "codex", "gemini") })).toBe("gemini");
  });

  it("returns null with only two agents", async () => {
    expect(await pickThirdParty({ config: {}, hostAgent: "claude", reviewerAgent: "codex", detectAgents: agentsUp("claude", "codex") })).toBeNull();
  });
});

describe("runSolomonArbitration", () => {
  const config = { roles: { solomon: { provider: "gemini" } } };
  const base = { config, projectDir: null, hostAgent: "claude", detectAgents: agentsUp("claude", "codex", "gemini") };
  const ruling = (r) => ({ reviewTask: vi.fn().mockResolvedValue({ ok: true, output: JSON.stringify({ ruling: r, reasoning: "because" }) }) });

  async function seedRejected(issues) {
    await saveVerdict(dir, DIFF, { verdict: "rejected", reviewer: "codex", issues });
  }

  it("approve ruling records a verdict that opens the gate", async () => {
    await seedRejected([{ id: "I1", severity: "medium", description: "naming could be better" }]);
    const agent = ruling("approve");
    const res = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "style-only, tests green", createAgentFn: () => agent });
    expect(res.ruling).toBe("approve");
    expect(res.solomon).toBe("gemini");
    const check = await checkVerdict(dir, DIFF);
    expect(check.ok).toBe(true);
    expect(check.verdict.reviewer).toBe("solomon:gemini");
    expect(check.verdict.arbitration.position).toMatch(/style-only/);
  });

  // KJC-BUG-0357 (#2151): an arbiter that answers with a stream-json event stream.
  it("reads the ruling from a stream-json event stream that starts with hook events", async () => {
    await seedRejected([{ id: "I1", severity: "medium", description: "naming" }]);
    const answer = JSON.stringify({ ruling: "approve", reasoning: "because" });
    const output = [{ type: "system", subtype: "hook_started" }, { type: "result", result: answer }].map((e) => JSON.stringify(e)).join("\n");
    const agent = { reviewTask: vi.fn().mockResolvedValue({ ok: true, output }) };
    const res = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "style-only", createAgentFn: () => agent });
    expect(res.ruling).toBe("approve");
  });

  // KJC-BUG-0183: the overriding verdict keeps the evidence bound to the diff
  // (sonar, rag) — otherwise --check refuses every arbitrated diff.
  it("approve ruling carries the sonar and rag blocks of the rejected verdict it overrides", async () => {
    const sonar = { ran: true, projectKey: "k", covered: ["x.js"], uncovered: [], blocking: 0, advisory: 0, mode: "pass" };
    const rag = { mode: "pass", sessionId: "s1", queries: 2, covered: ["x.js"], uncovered: [], twinsUntouched: [] };
    await saveVerdict(dir, DIFF, { verdict: "rejected", reviewer: "codex", issues: [{ id: "I1", severity: "high", description: "misread import" }], sonar, rag });
    await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "false positive", createAgentFn: () => ruling("approve") });
    const check = await checkVerdict(dir, DIFF);
    expect(check.ok).toBe(true);
    expect(check.verdict).toMatchObject({ reviewer: "solomon:gemini", sonar, rag });
  });

  // KJC-BUG-0121 layer 3: a binary on PATH is not an operational arbiter
  // (dead tier, auth, trust). The failure must carry the way out.
  it("an arbiter that fails at runtime produces an actionable error naming alternatives", async () => {
    await seedRejected([{ id: "I1", severity: "medium", description: "naming" }]);
    const dead = { reviewTask: vi.fn().mockResolvedValue({ ok: false, error: "IneligibleTierError: migrate to Antigravity" }) };
    await expect(runSolomonArbitration({
      ...base, detectAgents: agentsUp("claude", "codex", "gemini", "opencode"),
      projectDir: dir, diff: DIFF, position: "disagree", createAgentFn: () => dead,
    })).rejects.toThrow(/IneligibleTierError[\s\S]*roles\.solomon\.provider[\s\S]*opencode/);
  });

  it("when no alternative arbiter exists, the error says install-or-fix", async () => {
    await seedRejected([{ id: "I1", severity: "medium", description: "naming" }]);
    const dead = { reviewTask: vi.fn().mockResolvedValue({ ok: false, error: "not trusted" }) };
    await expect(runSolomonArbitration({
      ...base, projectDir: dir, diff: DIFF, position: "disagree", createAgentFn: () => dead,
    })).rejects.toThrow(/install a third agent CLI or fix gemini/);
  });

  it("reject ruling keeps the gate closed and records the arbitration", async () => {
    await seedRejected([{ id: "I1", severity: "high", description: "off-by-one in loop" }]);
    const res = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "I disagree", createAgentFn: () => ruling("reject") });
    expect(res.ruling).toBe("reject");
    expect((await checkVerdict(dir, DIFF)).ok).toBe(false);
  });

  it("security issues are never overridable — the arbiter is not even consulted", async () => {
    await seedRejected([{ id: "S1", severity: "critical", description: "SQL injection via unsanitized user input" }]);
    const agent = ruling("approve");
    const res = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "it is fine", createAgentFn: () => agent });
    expect(res.ruling).toBe("reject");
    expect(res.reasoning).toMatch(/security/i);
    expect(agent.reviewTask).not.toHaveBeenCalled();
    expect((await checkVerdict(dir, DIFF)).ok).toBe(false);
  });

  it("structured category blocks arbitration even with neutral wording", async () => {
    await seedRejected([{ id: "I9", severity: "high", category: "security", description: "input handling could be improved" }]);
    const agent = ruling("approve");
    const res = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "cosmetic", createAgentFn: () => agent });
    expect(res.ruling).toBe("reject");
    expect(agent.reviewTask).not.toHaveBeenCalled();
  });

  // KJC-BUG-0476 (#3137): the refusal names the finding and why it counts as security.
  it("a security refusal names each blocking finding and its reason", async () => {
    await seedRejected([
      { id: "C1", severity: "high", description: "rollback leaves the member unrestored" },
      { id: "S2", severity: "high", description: "the session cookie is read before the check" },
      { id: "S3", severity: "medium", category: "security", description: "input handling" },
    ]);
    const res = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "p", createAgentFn: () => ruling("approve") });
    expect(res.ruling).toBe("reject");
    expect(res.reasoning).toMatch(/S2 \(matches "session"\): the session cookie/);
    expect(res.reasoning).toMatch(/S3 \(category security\): input handling/);
    expect(res.reasoning).not.toMatch(/C1/);
  });

  // KJC-TSK-1379 (#3207): one finding at a time; the gate opens only when none is left.
  describe("--finding <id>", () => {
    const two = [
      { id: "C1", severity: "high", file: "a.js", line: 3, description: "rollback leaves the member unrestored" },
      { id: "C2", severity: "medium", file: "b.js", line: 9, description: "name could be clearer" },
    ];

    it("the arbiter sees only that finding, and approving it keeps the others blocking", async () => {
      await seedRejected(two);
      const agent = ruling("approve");
      const res = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "C2 is cosmetic", findingId: "C2", createAgentFn: () => agent });
      const prompt = agent.reviewTask.mock.calls[0][0].prompt;
      expect(prompt).toMatch(/"id": "C2"/);
      expect(prompt).not.toMatch(/"id": "C1"/);
      expect(res.ruling).toBe("approve");
      expect(res.remaining).toEqual(["C1"]);
      const check = await checkVerdict(dir, DIFF);
      expect(check.ok).toBe(false);
      expect(check.verdict.issues.map((i) => i.id)).toEqual(["C1"]);
      expect(check.verdict.arbitration.findingId).toBe("C2");
    });

    it("approving the last finding left opens the gate", async () => {
      await seedRejected([two[1]]);
      const res = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "p", findingId: "C2", createAgentFn: () => ruling("approve") });
      expect(res.remaining).toEqual([]);
      expect((await checkVerdict(dir, DIFF)).ok).toBe(true);
    });

    it("a security finding is still never arbitrated, and an unknown id names the ones there are", async () => {
      await seedRejected([...two, { id: "S1", severity: "high", category: "security", description: "x" }]);
      const agent = ruling("approve");
      const sec = await runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "p", findingId: "S1", createAgentFn: () => agent });
      expect(sec.ruling).toBe("reject");
      expect(agent.reviewTask).not.toHaveBeenCalled();
      await expect(runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "p", findingId: "Z9", createAgentFn: () => agent }))
        .rejects.toThrow(/Z9.*C1, C2, S1/);
    });
  });

  it("errors without a prior rejected verdict (nothing to arbitrate)", async () => {
    await expect(runSolomonArbitration({ ...base, projectDir: dir, diff: DIFF, position: "p" }))
      .rejects.toThrow(/nothing to arbitrate/i);
  });

  it("errors with only two agents — never self-arbitration", async () => {
    await seedRejected([{ id: "I1", severity: "low", description: "minor" }]);
    await expect(runSolomonArbitration({
      ...base, projectDir: dir, diff: DIFF, position: "p", detectAgents: agentsUp("claude", "codex"),
    })).rejects.toThrow(/third/i);
  });
});

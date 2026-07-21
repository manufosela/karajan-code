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

// KJC-TSK-0729 fase 2 — Kimi Code (Moonshot, binary `kimi`) as the eighth
// built-in agent: the free-tier reserve of the reviewer/solomon panel.
// CLI surface verified live against kimi-code 0.27.0: `-p <prompt>` prints
// the response (text by default), `-m <model>`, `-y` auto-approves actions.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KimiAgent } from "../../src/agents/kimi-agent.js";
import { createAgent, getAgentMeta } from "../../src/agents/index.js";
import { buildMockEnvironment } from "../../src/infrastructure/mocks.js";
import { KNOWN_AGENTS, OBSERVED_AGENTS } from "../../src/utils/agent-detect.js";
import { REVIEWER_CANDIDATES } from "../../src/review/reviewer-fallback.js";
import { AGENT_EXTRAS } from "../../src/utils/role-env.js";

describe("KimiAgent", () => {
  let runCommand, env;
  beforeEach(() => {
    env = buildMockEnvironment();
    runCommand = vi.spyOn(env.runner, "run").mockResolvedValue({ exitCode: 0, stdout: '{"approved":true}', stderr: "" });
  });

  it("is registered as a built-in agent with the kimi binary", () => {
    expect(getAgentMeta("kimi")).toMatchObject({ bin: "kimi" });
    expect(createAgent("kimi", {}, {}, env)).toBeInstanceOf(KimiAgent);
  });

  it("reviewTask runs -p with a no-tools instruction and NO auto-approval flags", async () => {
    const agent = new KimiAgent("kimi", {}, {}, env);
    const res = await agent.reviewTask({ prompt: "review this diff", role: "reviewer" });
    const [bin, args] = runCommand.mock.calls[0];
    expect(bin).toMatch(/kimi/);
    expect(args).toContain("-p");
    expect(args[args.indexOf("-p") + 1]).toMatch(/^Do NOT use any tools[\s\S]*review this diff$/);
    expect(args).not.toContain("-y");
    expect(args).not.toContain("--auto");
    expect(res.ok).toBe(true);
    expect(res.output).toBe('{"approved":true}');
  });

  it("runTask auto-approves actions (a coder must act) and honours the role model pin", async () => {
    const agent = new KimiAgent("kimi", { roles: { coder: { model: "k2.6" } } }, {}, env);
    await agent.runTask({ prompt: "build it", role: "coder" });
    const [, args] = runCommand.mock.calls[0];
    expect(args).toContain("-y");
    expect(args).toContain("-m");
    expect(args[args.indexOf("-m") + 1]).toBe("k2.6");
  });

  it("forwards task.cwd to the spawn — tournament lanes run the coder INSIDE the lane (TOR-A)", async () => {
    const agent = new KimiAgent("kimi", {}, {}, env);
    await agent.runTask({ prompt: "x", role: "coder", cwd: "/tmp/lane-1" });
    const [, , options] = runCommand.mock.calls[0];
    expect(options.cwd).toBe("/tmp/lane-1");
  });

  it("maps non-zero exit to ok:false with stderr as the error", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error: failed to run prompt" });
    const agent = new KimiAgent("kimi", {}, {}, env);
    const res = await agent.reviewTask({ prompt: "x", role: "reviewer" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("failed to run prompt");
  });
});

describe("kimi promotion: supported, not merely observed", () => {
  it("moves from the observation census into KNOWN_AGENTS (detecting is not supporting — supporting is)", () => {
    expect(KNOWN_AGENTS.map((a) => a.name)).toContain("kimi");
    expect(OBSERVED_AGENTS.map((a) => a.name)).not.toContain("kimi");
  });

  it("stops being adapterPending in the reviewer-fallback registry", () => {
    const kimi = REVIEWER_CANDIDATES.find((c) => c.name === "kimi");
    expect(kimi.adapterPending).toBeUndefined();
  });

  it("gets only its own auth env prefixes in the allowlist", () => {
    expect(AGENT_EXTRAS.kimi).toEqual(["KIMI_", "MOONSHOT_"]);
  });
});

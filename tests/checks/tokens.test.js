import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn(),
}));

describe("checks/tokens", () => {
  let mod, agentDetect;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    mod = await import("../../src/checks/tokens.js");
    agentDetect = await import("../../src/utils/agent-detect.js");
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
  });

  it("emits one check per active provider", () => {
    const checks = mod.getTokenChecks({
      roles: { coder: { provider: "claude" }, reviewer: { provider: "openai" } },
    });
    const names = checks.map((c) => c.name);
    expect(names).toContain("token:anthropic");
    expect(names).toContain("token:openai");
    expect(names).toContain("token:gh"); // always present
  });

  it("skips inactive providers", () => {
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "claude" } } });
    const names = checks.map((c) => c.name);
    expect(names).not.toContain("token:openai");
  });

  it("provider check passes when env var is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-xxx";
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "claude" } } });
    const anth = checks.find((c) => c.name === "token:anthropic");
    const result = await anth.detect({});
    expect(result.ok).toBe(true);
  });

  it("provider check fails with helpful fix when env var missing", async () => {
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "claude" } } });
    const anth = checks.find((c) => c.name === "token:anthropic");
    const result = await anth.detect({});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("fail");
    expect(result.fix).toContain("console.anthropic.com");
    expect(result.fix).toContain("ANTHROPIC_API_KEY");
  });

  it("optional providers warn instead of fail", async () => {
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "opencode" } } });
    const oc = checks.find((c) => c.name === "token:opencode");
    const result = await oc.detect({});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warn");
  });

  it("gh token check applies only when auto_pr is on", () => {
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "claude" } } });
    const gh = checks.find((c) => c.name === "token:gh");
    expect(gh.applies({ git: { auto_pr: true } })).toBe(true);
    expect(gh.applies({ git: { auto_pr: false } })).toBe(false);
    expect(gh.applies({})).toBe(false);
  });

  it("gh token: OK when GH_TOKEN set", async () => {
    process.env.GH_TOKEN = "ghp_xxx";
    const checks = mod.getTokenChecks({});
    const gh = checks.find((c) => c.name === "token:gh");
    const result = await gh.detect({});
    expect(result.ok).toBe(true);
  });

  it("gh token: FAIL with 'install gh' hint when CLI missing", async () => {
    agentDetect.checkBinary.mockResolvedValue({ ok: false });
    const checks = mod.getTokenChecks({});
    const gh = checks.find((c) => c.name === "token:gh");
    const result = await gh.detect({});
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("cli.github.com");
  });

  it("gh token: FAIL with 'gh auth login' hint when CLI present", async () => {
    agentDetect.checkBinary.mockResolvedValue({ ok: true, version: "2.50.0" });
    const checks = mod.getTokenChecks({});
    const gh = checks.find((c) => c.name === "token:gh");
    const result = await gh.detect({});
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("gh auth login");
  });
});

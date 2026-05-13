import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn(),
}));

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));

describe("checks/tokens — provider CLI availability (post-v2.7.4)", () => {
  let mod, agentDetect;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    delete process.env.AIDER_API_KEY;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    mod = await import("../../src/checks/tokens.js");
    agentDetect = await import("../../src/utils/agent-detect.js");
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
  });

  it("emits one CLI check per active provider (anthropic→claude, openai→codex)", () => {
    const checks = mod.getTokenChecks({
      roles: { coder: { provider: "claude" }, reviewer: { provider: "openai" } },
    });
    const names = checks.map((c) => c.name);
    expect(names).toContain("cli:anthropic");
    expect(names).toContain("cli:openai");
    expect(names).toContain("token:gh"); // always present
  });

  it("skips inactive providers", () => {
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "claude" } } });
    const names = checks.map((c) => c.name);
    expect(names).not.toContain("cli:openai");
  });

  it("provider check passes when the CLI is on PATH (env var IRRELEVANT)", async () => {
    // The whole point of v2.7.4: NO env var is needed. CLI presence is enough.
    agentDetect.checkBinary.mockResolvedValue({ ok: true, version: "1.2.3", path: "/usr/bin/claude" });
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "claude" } } });
    const anth = checks.find((c) => c.name === "cli:anthropic");
    const result = await anth.detect({});
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("claude on PATH");
    expect(result.detail).toContain("1.2.3");
  });

  it("provider check fails with install hint when the CLI is missing", async () => {
    agentDetect.checkBinary.mockResolvedValue({ ok: false });
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "claude" } } });
    const anth = checks.find((c) => c.name === "cli:anthropic");
    const result = await anth.detect({});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("fail");
    expect(result.detail).toContain("claude not found");
    expect(result.fix).toContain("Install");
    expect(result.fix).toContain("console.anthropic.com");
  });

  it("optional providers (opencode) warn instead of fail when CLI missing", async () => {
    agentDetect.checkBinary.mockResolvedValue({ ok: false });
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "opencode" } } });
    const oc = checks.find((c) => c.name === "cli:opencode");
    const result = await oc.detect({});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warn");
  });

  it("openai → codex CLI mapping", async () => {
    agentDetect.checkBinary.mockResolvedValue({ ok: true, version: "0.5.0" });
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "openai" } } });
    const oai = checks.find((c) => c.name === "cli:openai");
    const result = await oai.detect({});
    expect(result.ok).toBe(true);
    expect(agentDetect.checkBinary).toHaveBeenCalledWith("codex");
  });

  it("google → gemini CLI mapping", async () => {
    agentDetect.checkBinary.mockResolvedValue({ ok: true, version: "0.1.0" });
    const checks = mod.getTokenChecks({ roles: { coder: { provider: "google" } } });
    const g = checks.find((c) => c.name === "cli:google");
    const result = await g.detect({});
    expect(result.ok).toBe(true);
    expect(agentDetect.checkBinary).toHaveBeenCalledWith("gemini");
  });

  // regression-for: regression
  it("does NOT touch ANTHROPIC_API_KEY / OPENAI_API_KEY anywhere (regression guard)", async () => {
    // Set both env vars; the result must depend on the CLI, not on env.
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.OPENAI_API_KEY = "sk-test";
    agentDetect.checkBinary.mockResolvedValue({ ok: false });
    const checks = mod.getTokenChecks({
      roles: { coder: { provider: "claude" }, reviewer: { provider: "openai" } },
    });
    const anth = checks.find((c) => c.name === "cli:anthropic");
    const oai = checks.find((c) => c.name === "cli:openai");
    expect((await anth.detect({})).ok).toBe(false);
    expect((await oai.detect({})).ok).toBe(false);
  });

  it("gh token check applies only when auto_pr is on (unchanged from pre-v2.7.4)", () => {
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

  it("gh token: FAIL with 'gh auth login' hint when CLI present but `gh auth status` says not logged in", async () => {
    agentDetect.checkBinary.mockResolvedValue({ ok: true, version: "2.50.0" });
    const proc = await import("../../src/utils/process.js");
    proc.runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "not logged in" });
    const checks = mod.getTokenChecks({});
    const gh = checks.find((c) => c.name === "token:gh");
    const result = await gh.detect({});
    expect(result.ok).toBe(false);
    expect(result.fix).toContain("gh auth login");
  });

  it("gh token: OK when CLI is authenticated via keyring (KJC-BUG-0049)", async () => {
    agentDetect.checkBinary.mockResolvedValue({ ok: true, version: "2.50.0" });
    const proc = await import("../../src/utils/process.js");
    proc.runCommand.mockResolvedValue({ exitCode: 0, stdout: "Logged in to github.com", stderr: "" });
    const checks = mod.getTokenChecks({});
    const gh = checks.find((c) => c.name === "token:gh");
    const result = await gh.detect({});
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/keyring|OAuth/i);
  });
});

describe("session-store/addCheckpoint — defensive guard for stub sessions", () => {
  it("initialises checkpoints when missing (no crash on stub session)", async () => {
    const { addCheckpoint } = await import("../../src/session/store.js");
    // Stub session as built by flow-runner.js init-error path BEFORE the v2.7.4 fix.
    // Pre-v2.7.4 this crashed with "Cannot read properties of undefined (reading 'push')".
    const stub = { id: "init-error", task: "x", status: "failed" };
    // saveSession would touch fs — make it a no-op via a temp dir if needed; but
    // for now we accept that the test will try to write. If saveSession fails,
    // the .push() guard already ran and that's what we're testing.
    try {
      await addCheckpoint(stub, { stage: "test", iteration: 0 });
    } catch (err) {
      // Acceptable: saveSession may fail with no fs setup. We only care that
      // the .push() didn't crash.
      if (/Cannot read properties of undefined.*push/.test(err.message)) {
        throw new Error("addCheckpoint regressed: still crashes on missing checkpoints array", { cause: err });
      }
    }
    expect(Array.isArray(stub.checkpoints)).toBe(true);
    expect(stub.checkpoints.length).toBe(1);
    expect(stub.checkpoints[0].stage).toBe("test");
  });
});

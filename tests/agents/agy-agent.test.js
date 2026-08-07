// KJC-TSK-0729 fase 2b — Antigravity CLI (`agy`, Google's successor to the
// retired gemini CLI) as the ninth built-in agent. CLI surface verified live
// against agy 1.1.10: `-p` print mode, `--output-format json` emits ONE JSON
// object ({status, response, usage}), `--model`, permissions denied unless
// `--dangerously-skip-permissions`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgyAgent, extractAgyOutput } from "../../src/agents/agy-agent.js";
import { createAgent, getAgentMeta } from "../../src/agents/index.js";
import { buildMockEnvironment } from "../../src/infrastructure/mocks.js";
import { KNOWN_AGENTS } from "../../src/utils/agent-detect.js";
import { REVIEWER_CANDIDATES } from "../../src/review/reviewer-fallback.js";

const AGY_JSON = JSON.stringify({
  conversation_id: "x",
  status: "SUCCESS",
  response: '{"approved":true,"blocking_issues":[]}',
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe("AgyAgent", () => {
  let runCommand, env;
  beforeEach(() => {
    env = buildMockEnvironment();
    runCommand = vi.spyOn(env.runner, "run").mockResolvedValue({ exitCode: 0, stdout: AGY_JSON, stderr: "" });
  });

  it("is registered as a built-in agent with the agy binary", () => {
    expect(getAgentMeta("agy")).toMatchObject({ bin: "agy" });
    expect(createAgent("agy", {}, {}, env)).toBeInstanceOf(AgyAgent);
  });

  it("reviewTask prints with json output, slash expansion off, no permission skips, no-tools instruction", async () => {
    const agent = new AgyAgent("agy", {}, {}, env);
    const res = await agent.reviewTask({ prompt: "review this diff", role: "reviewer" });
    const [bin, args] = runCommand.mock.calls[0];
    expect(bin).toMatch(/agy/);
    expect(args[args.indexOf("-p") + 1]).toMatch(/^Do NOT use any tools[\s\S]*review this diff$/);
    expect(args).toContain("--output-format");
    expect(args).toContain("--disable-slash-commands");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(res.ok).toBe(true);
    expect(res.output).toBe('{"approved":true,"blocking_issues":[]}');
  });

  it("runTask skips permission prompts (a coder must act) and honours the role model pin", async () => {
    const agent = new AgyAgent("agy", { roles: { coder: { model: "gemini-3.1-pro" } } }, {}, env);
    await agent.runTask({ prompt: "build it", role: "coder" });
    const [, args] = runCommand.mock.calls[0];
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-3.1-pro");
  });

  it("a non-SUCCESS status maps to ok:false even with exit 0", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ status: "ERROR", response: "", error: "quota exceeded" }),
      stderr: "",
    });
    const agent = new AgyAgent("agy", {}, {}, env);
    const res = await agent.reviewTask({ prompt: "x", role: "reviewer" });
    expect(res.ok).toBe(false);
  });

  it("extractAgyOutput returns the response field, or null on non-JSON", () => {
    expect(extractAgyOutput(AGY_JSON).response).toBe('{"approved":true,"blocking_issues":[]}');
    expect(extractAgyOutput("garbage")).toBeNull();
  });
});

describe("agy promotion", () => {
  it("joins KNOWN_AGENTS and stops being adapterPending in the fallback registry", () => {
    expect(KNOWN_AGENTS.map((a) => a.name)).toContain("agy");
    const agy = REVIEWER_CANDIDATES.find((c) => c.name === "agy");
    expect(agy.adapterPending).toBeUndefined();
    expect(agy.authPaths).toContain(".gemini/antigravity-cli");
  });
});

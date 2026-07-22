// KJC-TSK-0666 — GitHub Copilot CLI as seventh built-in agent. Contract
// verified live against copilot 1.0.73 (JSONL events, -p prompt, no stdin
// channel).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CopilotAgent, extractCopilotOutput } from "../../src/agents/copilot-agent.js";
import { createAgent, getAgentMeta } from "../../src/agents/index.js";
import { buildMockEnvironment } from "../../src/infrastructure/mocks.js";

const JSONL = [
  '{"type":"user.message","data":{"content":"x"}}',
  "log noise that is not json",
  '{"type":"assistant.message_delta","data":{"content":"{"}}',
  '{"type":"assistant.message","data":{"content":"{\\"ruling\\":\\"approve\\",\\"reasoning\\":\\"ok\\"}","model":"gpt-5-mini"}}',
  '{"type":"result","exitCode":0,"usage":{"premiumRequests":0.33}}',
].join("\n");

describe("CopilotAgent", () => {
  let runCommand, env;
  beforeEach(() => {
    env = buildMockEnvironment();
    runCommand = vi.spyOn(env.runner, "run").mockResolvedValue({ exitCode: 0, stdout: JSONL, stderr: "" });
  });

  it("is registered as a built-in agent with the copilot binary", () => {
    expect(getAgentMeta("copilot")).toMatchObject({ bin: "copilot" });
    expect(createAgent("copilot", {}, {}, env)).toBeInstanceOf(CopilotAgent);
  });

  it("reviewTask runs -p with JSONL output, no tool grants, and a no-tools instruction", async () => {
    const agent = new CopilotAgent("copilot", {}, {}, env);
    const res = await agent.reviewTask({ prompt: "arbitrate this", role: "solomon" });
    const [bin, args] = runCommand.mock.calls[0];
    expect(bin).toMatch(/copilot/);
    expect(args).toContain("-p");
    expect(args[args.indexOf("-p") + 1]).toMatch(/^Do NOT use any tools[\s\S]*arbitrate this$/);
    expect(args).toContain("--output-format");
    expect(args).not.toContain("--allow-all-tools");
    // the parsed assistant.message content is the agent output
    expect(res.output).toBe('{"ruling":"approve","reasoning":"ok"}');
    expect(res.ok).toBe(true);
  });

  it("runTask grants tools (a coder must edit files) and honours the role model", async () => {
    const agent = new CopilotAgent("copilot", { roles: { coder: { model: "gpt-5.1-codex" } } }, {}, env);
    await agent.runTask({ prompt: "build it", role: "coder" });
    const args = runCommand.mock.calls[0][1];
    expect(args).toContain("--allow-all-tools");
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.1-codex");
  });

  it("solomon can pick copilot as third party (claude brain, codex reviewer)", async () => {
    const { pickThirdParty } = await import("../../src/review/solomon-arbitration.js");
    const detectAgents = async () => [
      { name: "claude", available: true }, { name: "codex", available: true }, { name: "copilot", available: true },
    ];
    expect(await pickThirdParty({ config: {}, hostAgent: "claude", reviewerAgent: "codex", detectAgents })).toBe("copilot");
  });
});

describe("extractCopilotOutput", () => {
  it("returns the LAST assistant.message content, ignoring deltas and noise", () => {
    expect(extractCopilotOutput(JSONL)).toBe('{"ruling":"approve","reasoning":"ok"}');
  });

  it("returns null when no assistant.message exists (caller falls back to raw stdout)", () => {
    expect(extractCopilotOutput('{"type":"result","exitCode":1}')).toBeNull();
    expect(extractCopilotOutput("")).toBeNull();
  });
});

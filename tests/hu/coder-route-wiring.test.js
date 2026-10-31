// KJC-TSK-1070 (MR-D2): the route of each HU reaches its coder. The HU's
// coder_model (kj plan fills it from the tier; the user may change it on the
// board) drives the first iteration, and a failed one climbs to the top model.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNoopLogger } from "../_fixtures/loggers.js";
import { baseAgentConfig } from "../_fixtures/agents.js";
import { applyCoderRoute, routeCoder } from "../../src/hu/coder-routing.js";

vi.mock("../../src/utils/process.js", () => ({ runCommand: vi.fn() }));
vi.mock("../../src/agents/resolve-bin.js", () => ({ resolveBin: vi.fn((name) => `/usr/local/bin/${name}`) }));

const logger = createNoopLogger();
const config = () => ({ coder: "claude", roles: { coder: { provider: null, model: null } } });

describe("the HU's coder_model", () => {
  it("drives the first iteration and gives way to the top model after a failure", () => {
    expect(routeCoder({ tier: "trivial", huModel: "sonnet", attempt: 1, config: config() })).toMatchObject({ model: "sonnet", effort: "low" });
    expect(routeCoder({ tier: "deep", huModel: "sonnet", attempt: 1, config: config() })).toMatchObject({ model: "sonnet", effort: null });
    expect(routeCoder({ tier: "trivial", huModel: "sonnet", attempt: 2, config: config() })).toMatchObject({ model: "opus", escalated: true });
  });
});

describe("applyCoderRoute", () => {
  it("writes the route on the lane config and says why; a skipped route clears it", () => {
    const lane = config();
    const info = vi.fn();
    applyCoderRoute({ laneConfig: lane, story: { id: "HU-1", complexity: { tier: "trivial" } }, attempt: 1, config: config(), logger: { info } });
    expect(lane.coder_route).toEqual({ model: "haiku", effort: "low" });
    expect(info.mock.calls[0][0]).toMatch(/HU-1.*haiku/);
    applyCoderRoute({ laneConfig: lane, story: { id: "HU-1", complexity: { tier: "deep" } }, attempt: 1, config: config(), logger: { info } });
    expect(lane.coder_route).toBeNull();
  });
});

describe("the coder agent runs on the route", () => {
  let runCommand;
  beforeEach(async () => {
    vi.resetAllMocks();
    ({ runCommand } = await import("../../src/utils/process.js"));
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("claude takes --effort from the coder's config", async () => {
    const { ClaudeAgent } = await import("../../src/agents/claude-agent.js");
    const cfg = baseAgentConfig();
    cfg.roles = { ...cfg.roles, coder: { ...cfg.roles?.coder, model: "haiku", effort: "low" } };
    await new ClaudeAgent("claude", cfg, logger).runTask({ prompt: "t", role: "coder" });
    const args = runCommand.mock.calls[0][1];
    expect(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2)).toEqual(["--effort", "low"]);
    expect(args).toContain("haiku");
  });
});

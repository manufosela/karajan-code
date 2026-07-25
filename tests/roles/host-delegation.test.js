// KJC-BUG-0129 (issues #1301/#1303) — running INSIDE an agent does not
// make that agent "the host executor": a CLI-spawnable provider goes
// through a subprocess ALWAYS, or the instruction prompt lands on the
// board as a hanging "question". Host delegation is explicit opt-in.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoderRole } from "../../src/roles/coder-role.js";
import { HostAgent } from "../../src/agents/host-agent.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
const subprocessAgent = { name: "opencode-subprocess" };

function role(config) {
  const r = new CoderRole({ config, logger, askHost: vi.fn() });
  r._createAgent = vi.fn(() => subprocessAgent);
  return r;
}

const HOST_ENVS = ["CLAUDECODE", "CLAUDE_CODE", "CODEX_CLI", "CODEX", "GEMINI_CLI", "OPENCODE"];
const saved = {};
beforeEach(() => {
  vi.clearAllMocks();
  for (const k of HOST_ENVS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENCODE = "1"; // the test runner itself runs inside Claude Code
});
afterEach(() => {
  for (const k of HOST_ENVS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("coder host delegation (KJC-BUG-0129)", () => {
  it("running inside opencode with provider opencode spawns the SUBPROCESS by default", () => {
    const agent = role({ roles: { coder: { provider: "opencode" } } }).createAgentInstance("opencode");
    expect(agent).toBe(subprocessAgent);
    expect(logger.info.mock.calls.flat().join("\n")).toMatch(/subprocess/i);
  });

  it("host delegation remains available as explicit opt-in", () => {
    const agent = role({ roles: { coder: { provider: "opencode", host_delegation: true } } })
      .createAgentInstance("opencode");
    expect(agent).toBeInstanceOf(HostAgent);
  });

  it("outside any host, the provider spawns normally (no change)", () => {
    delete process.env.OPENCODE;
    const agent = role({}).createAgentInstance("opencode");
    expect(agent).toBe(subprocessAgent);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startCommand } from "../../src/commands/start.js";

/**
 * KJC-TSK-0570 (Onboard C) — `kj start` orchestration. Collaborators are
 * injected (deps) so no sweep runs and no CLI spawns. Asserts the read-only
 * loop wiring, --json output, the maturity flag, ASK_USER and crash-safety.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const config = { projectDir: "/tmp/proj" };

function deps(result, { sweepBundle = {} } = {}) {
  return {
    runReadOnlySweep: vi.fn(async () => sweepBundle),
    buildAssessment: vi.fn(() => ({ text: "ASSESSMENT TEXT", summary: { maturity: "existing" } })),
    makeDecider: () => ({ execute: vi.fn(async () => ({ result })) }),
  };
}

let logs;
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("startCommand (KJC-TSK-0570)", () => {
  it("runs sweep → assessment → decider and prints the recommended step", async () => {
    const d = deps({ intent: "RECOMMEND_HARDEN", rationale: "no tests" });
    const r = await startCommand({ task: "", config, logger, flags: {}, deps: d });
    expect(r.intent).toBe("RECOMMEND_HARDEN");
    expect(d.runReadOnlySweep).toHaveBeenCalledWith("/tmp/proj", { declared: null });
    const out = logs.join("\n");
    expect(out).toContain("ASSESSMENT TEXT");
    expect(out).toContain("kj harden");
  });

  it("emits JSON with maturity + intent under --json, applying nothing", async () => {
    const d = deps({ intent: "START_TASK", rationale: "go" });
    await startCommand({ task: "add x", config, logger, flags: { json: true }, deps: d });
    const parsed = JSON.parse(logs.join(""));
    expect(parsed.maturity).toBe("existing");
    expect(parsed.intent).toBe("START_TASK");
    expect(parsed.assessment).toBe("ASSESSMENT TEXT");
  });

  it("passes the declared maturity flag to the sweep", async () => {
    const d = deps({ intent: "ASSESS_ONLY" });
    await startCommand({ config, logger, flags: { maturity: "legacy" }, deps: d });
    expect(d.runReadOnlySweep).toHaveBeenCalledWith("/tmp/proj", { declared: "legacy" });
  });

  it("prints the open question when the decider returns ASK_USER", async () => {
    const d = deps({ intent: "ASK_USER", questionToAsk: "Build or fix?" });
    await startCommand({ config, logger, flags: {}, deps: d });
    expect(logs.join("\n")).toContain("Build or fix?");
  });

  it("degrades to ASK_USER instead of crashing when the decider throws", async () => {
    const d = deps({});
    d.makeDecider = () => ({ execute: vi.fn(async () => { throw new Error("claude not found"); }) });
    const r = await startCommand({ config, logger, flags: {}, deps: d });
    expect(r.intent).toBe("ASK_USER");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("feeds the user task and assessment into the decider", async () => {
    const execute = vi.fn(async () => ({ result: { intent: "START_TASK" } }));
    const d = { ...deps({ intent: "START_TASK" }), makeDecider: () => ({ execute }) };
    await startCommand({ task: "add logout", config, logger, flags: {}, deps: d });
    expect(execute).toHaveBeenCalledWith({ userMessage: "add logout", assessment: "ASSESSMENT TEXT" });
  });
});

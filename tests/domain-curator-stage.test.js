import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const mockExecute = vi.fn();

vi.mock("../src/roles/domain-curator-role.js", () => ({
  DomainCuratorRole: class {
    constructor() {}
    execute(...args) { return mockExecute(...args); }
  }
}));

const { runDomainCuratorStage } = await import("../src/orchestrator/stages/domain-curator-stage.js");

describe("runDomainCuratorStage", () => {
  let emitter;
  let events;
  let logger;
  let trackBudget;
  const eventBase = { sessionId: "s_test", iteration: 0, stage: null, startedAt: Date.now() };
  const session = { task: "implement login form" };

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new EventEmitter();
    events = [];
    emitter.on("progress", (e) => events.push(e));
    logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() };
    trackBudget = vi.fn();
  });

  it("returns domainContext and stageResult on success", async () => {
    mockExecute.mockResolvedValue({
      ok: true,
      result: {
        selectedDomains: ["auth", "security"],
        domainContext: "Auth patterns: JWT + session...",
        domainsFound: 5,
        domainsUsed: 2,
        source: "project"
      },
      summary: "2 domains selected"
    });

    const result = await runDomainCuratorStage({
      config: {}, logger, emitter, eventBase, session, trackBudget,
      domainHints: ["auth"]
    });

    expect(result.domainContext).toBe("Auth patterns: JWT + session...");
    expect(result.stageResult.ok).toBe(true);
    expect(result.stageResult.domainsFound).toBe(5);
    expect(result.stageResult.domainsUsed).toBe(2);
    expect(result.stageResult.selectedDomains).toEqual(["auth", "security"]);
    expect(result.stageResult.source).toBe("project");
    expect(result.stageResult.hasDomainContext).toBe(true);
  });

  it("returns null domainContext when no domains found", async () => {
    mockExecute.mockResolvedValue({
      ok: true,
      result: { selectedDomains: [], domainContext: null, domainsFound: 0, domainsUsed: 0, source: "none" },
      summary: "No domains found"
    });

    const result = await runDomainCuratorStage({
      config: {}, logger, emitter, eventBase, session, trackBudget
    });

    expect(result.domainContext).toBeNull();
    expect(result.stageResult.hasDomainContext).toBe(false);
    expect(result.stageResult.domainsFound).toBe(0);
  });

  it("handles curator errors gracefully", async () => {
    mockExecute.mockRejectedValue(new Error("filesystem error"));

    const result = await runDomainCuratorStage({
      config: {}, logger, emitter, eventBase, session, trackBudget
    });

    expect(result.domainContext).toBeNull();
    expect(result.stageResult.ok).toBe(true);
    expect(result.stageResult.source).toBe("error");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("filesystem error"));
  });

  it("emits start and done events", async () => {
    mockExecute.mockResolvedValue({
      ok: true,
      result: { selectedDomains: [], domainContext: null, domainsFound: 0, domainsUsed: 0, source: "none" },
      summary: "No domains"
    });

    await runDomainCuratorStage({
      config: {}, logger, emitter, eventBase, session, trackBudget,
      domainHints: ["payments"]
    });

    const startEvent = events.find(e => e.type === "domain-curator:start");
    const doneEvent = events.find(e => e.type === "domain-curator:done");

    expect(startEvent).toBeDefined();
    expect(startEvent.detail.domainHints).toEqual(["payments"]);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.status).toBe("ok");
  });

  it("calls trackBudget with duration", async () => {
    mockExecute.mockResolvedValue({
      ok: true,
      result: { selectedDomains: [], domainContext: null, domainsFound: 0, domainsUsed: 0, source: "none" },
      summary: "done"
    });

    await runDomainCuratorStage({
      config: {}, logger, emitter, eventBase, session, trackBudget
    });

    expect(trackBudget).toHaveBeenCalledWith(expect.objectContaining({
      role: "domain-curator",
      provider: "local",
      model: null
    }));
    expect(trackBudget.mock.calls[0][0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("passes domainHints and askQuestion to curator", async () => {
    const askQuestion = vi.fn();
    askQuestion.interactive = true;
    mockExecute.mockResolvedValue({
      ok: true,
      result: { selectedDomains: [], domainContext: null, domainsFound: 0, domainsUsed: 0, source: "none" },
      summary: "done"
    });

    await runDomainCuratorStage({
      config: { projectDir: "/tmp/project" }, logger, emitter, eventBase, session, trackBudget,
      domainHints: ["auth", "db"], askQuestion
    });

    expect(mockExecute).toHaveBeenCalledWith({
      task: "implement login form",
      domainHints: ["auth", "db"],
      askQuestion,
      projectDir: "/tmp/project"
    });
  });

  it("sets logger context to domain-curator stage", async () => {
    mockExecute.mockResolvedValue({
      ok: true,
      result: { selectedDomains: [], domainContext: null, domainsFound: 0, domainsUsed: 0, source: "none" },
      summary: "done"
    });

    await runDomainCuratorStage({
      config: {}, logger, emitter, eventBase, session, trackBudget
    });

    expect(logger.setContext).toHaveBeenCalledWith({ iteration: 0, stage: "domain-curator" });
  });
});

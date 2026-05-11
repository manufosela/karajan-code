import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn()
}));

const { readFile } = await import("node:fs/promises");
const { TriageRole } = await import("../src/roles/triage-role.js");

function createMockAgent(output) {
  return {
    runTask: vi.fn(async () => ({ ok: true, output: JSON.stringify(output) }))
  };
}

describe("TriageRole domainHints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFile.mockRejectedValue(new Error("ENOENT")); // no role .md override
  });

  it("parses domainHints from triage output", async () => {
    const triageOutput = {
      level: "medium",
      roles: ["planner", "reviewer"],
      reasoning: "Task involves dental workflows",
      taskType: "sw",
      shouldDecompose: false,
      subtasks: [],
      domainHints: ["dental", "clinical", "treatment"]
    };

    const mockAgent = createMockAgent(triageOutput);
    const triage = new TriageRole({
      config: {},
      logger: { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() },
      createAgentFn: () => mockAgent
    });

    await triage.init({ task: "test", sessionId: "s1", iteration: 0 });
    const result = await triage.execute({ task: "Create dental treatment workflow" });

    expect(result.ok).toBe(true);
    expect(result.result.domainHints).toEqual(["dental", "clinical", "treatment"]);
  });

  it("defaults domainHints to empty array when not in output", async () => {
    const triageOutput = {
      level: "simple",
      roles: ["reviewer"],
      reasoning: "Simple refactor",
      taskType: "refactor",
      shouldDecompose: false,
      subtasks: []
      // no domainHints field
    };

    const mockAgent = createMockAgent(triageOutput);
    const triage = new TriageRole({
      config: {},
      logger: { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() },
      createAgentFn: () => mockAgent
    });

    await triage.init({ task: "test", sessionId: "s1", iteration: 0 });
    const result = await triage.execute({ task: "Refactor component" });

    expect(result.ok).toBe(true);
    expect(result.result.domainHints).toEqual([]);
  });

  it("normalizes domainHints to lowercase trimmed strings", async () => {
    const triageOutput = {
      level: "medium",
      roles: ["reviewer"],
      reasoning: "test",
      taskType: "sw",
      domainHints: [" Dental ", "CLINICAL", "  ", 123]
    };

    const mockAgent = createMockAgent(triageOutput);
    const triage = new TriageRole({
      config: {},
      logger: { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() },
      createAgentFn: () => mockAgent
    });

    await triage.init({ task: "test", sessionId: "s1", iteration: 0 });
    const result = await triage.execute({ task: "test" });

    expect(result.result.domainHints).toEqual(["dental", "clinical"]);
  });
});

describe("PipelineContext domainContext", () => {
  it("has domainContext field defaulting to null", async () => {
    const { PipelineContext } = await import("../src/orchestrator/pipeline-context.js");
    const ctx = new PipelineContext({
      config: {},
      session: {},
      logger: {},
      emitter: {},
      task: "test"
    });

    expect(ctx.domainContext).toBeNull();
  });
});

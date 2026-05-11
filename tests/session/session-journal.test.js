import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import {
  createJournalDir,
  writePreLoopJournal,
  writeIterationsJournal,
  writeDecisionsJournal,
  formatIteration,
  formatDecision,
  generateSummary,
  buildPlanSummary
} from "../src/orchestrator/session-journal.js";

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined)
  }
}));

describe("session-journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createJournalDir", () => {
    it("creates the directory with recursive option", async () => {
      const dir = await createJournalDir(".reviews", "s_test_123");
      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("s_test_123"), { recursive: true });
      expect(dir).toContain("s_test_123");
    });
  });

  describe("writePreLoopJournal", () => {
    it("writes files for stages that have results", async () => {
      const stageResults = {
        triage: { level: "complex", taskType: "sw", roles: ["planner", "researcher"], reasoning: "Big task" },
        researcher: { affected_files: ["src/index.js"], risks: ["breaking change"], patterns: ["MVC"] },
        planner: { plan: "1. Init project\n2. Add routes\n3. Add tests" }
      };

      const files = await writePreLoopJournal("/tmp/journal", stageResults);
      expect(files).toContain("triage.md");
      expect(files).toContain("research.md");
      expect(files).toContain("plan.md");
      expect(files).not.toContain("discovery.md");
      expect(files).not.toContain("architecture.md");
    });

    it("skips all files when no stage results", async () => {
      const files = await writePreLoopJournal("/tmp/journal", {});
      expect(files).toHaveLength(0);
    });

    it("writes architecture with all sections", async () => {
      const stageResults = {
        architect: {
          verdict: "ready",
          architecture: {
            type: "monolith",
            layers: ["API", "Service", "DB"],
            patterns: ["Repository", "Middleware"],
            dataModel: { entities: ["User", "Task"] },
            apiContracts: ["GET /tasks", "POST /tasks"],
            tradeoffs: ["Simple but not scalable"]
          },
          questions: ["Should we add caching?"]
        }
      };

      const files = await writePreLoopJournal("/tmp/journal", stageResults);
      expect(files).toContain("architecture.md");
      const writeCall = fs.writeFile.mock.calls.find(c => c[0].includes("architecture.md"));
      expect(writeCall[1]).toContain("monolith");
      expect(writeCall[1]).toContain("Repository");
      expect(writeCall[1]).toContain("Should we add caching?");
    });
  });

  describe("formatIteration", () => {
    it("formats a complete iteration entry", () => {
      const entry = formatIteration({
        iteration: 2,
        coderSummary: "Added 3 files",
        reviewerSummary: "Approved with 1 suggestion",
        sonarSummary: "2 issues found",
        durationMs: 45000
      });
      expect(entry).toContain("## Iteration 2");
      expect(entry).toContain("45s");
      expect(entry).toContain("Added 3 files");
      expect(entry).toContain("Approved with 1 suggestion");
      expect(entry).toContain("2 issues found");
    });

    it("omits missing stages", () => {
      const entry = formatIteration({ iteration: 1, coderSummary: "Done", durationMs: 10000 });
      expect(entry).toContain("**Coder**: Done");
      expect(entry).not.toContain("Reviewer");
      expect(entry).not.toContain("Sonar");
    });
  });

  describe("formatDecision", () => {
    it("formats a solomon decision", () => {
      const entry = formatDecision({
        timestamp: "2026-04-03T12:00:00Z",
        trigger: "reviewer retry limit reached",
        context: "3/3 retries exhausted",
        action: "continue with guidance",
        reasoning: "Issues are cosmetic, not blocking"
      });
      expect(entry).toContain("2026-04-03T12:00:00Z");
      expect(entry).toContain("reviewer retry limit");
      expect(entry).toContain("continue with guidance");
      expect(entry).toContain("cosmetic");
    });
  });

  describe("generateSummary", () => {
    it("generates a complete summary", () => {
      const summary = generateSummary({
        task: "Build REST API",
        result: "APPROVED",
        sessionId: "s_test",
        iterations: 2,
        durationMs: 120000,
        budget: { total_cost_usd: 0.75, total_tokens: 8000 },
        stages: {
          triage: { ok: true, summary: "complex" },
          coder: { ok: true, summary: "Done" },
          reviewer: { ok: true, summary: "Approved" }
        },
        commits: [{ hash: "abc1234def", message: "feat: add routes" }],
        files: ["triage.md", "plan.md", "iterations.md"]
      });
      expect(summary).toContain("APPROVED");
      expect(summary).toContain("$0.75");
      expect(summary).toMatch(/8[,.]?000/);
      expect(summary).toContain("abc1234");
      expect(summary).toContain("[triage.md]");
    });
  });

  describe("buildPlanSummary", () => {
    it("builds a console-friendly plan summary", () => {
      const output = buildPlanSummary({
        task: "Build a task management API with Express",
        pipelineFlags: {
          researcherEnabled: true,
          architectEnabled: false,
          plannerEnabled: true,
          refactorerEnabled: false,
          reviewerEnabled: true,
          testerEnabled: true,
          securityEnabled: true,
          impeccableEnabled: false
        },
        config: {
          development: { methodology: "tdd" },
          max_iterations: 5,
          pipeline: { solomon: { enabled: true } }
        },
        stageResults: {
          triage: { level: "complex", taskType: "sw", roles: ["planner", "researcher"] },
          planner: { plan: "1. Init project\n2. Add models\n3. Add routes\n4. Add auth\n5. Add tests\n6. Add docs" }
        }
      });
      expect(output).toContain("Pipeline Plan");
      expect(output).toContain("Researcher → Planner → Coder → Reviewer → Tester → Security");
      expect(output).toContain("tdd");
      expect(output).toContain("complex");
      expect(output).toContain("1. Init project");
      expect(output).toContain("1 more steps");
    });

    it("works without planner output", () => {
      const output = buildPlanSummary({
        task: "Fix login bug",
        pipelineFlags: { reviewerEnabled: true },
        config: { max_iterations: 3 },
        stageResults: { triage: { level: "simple", taskType: "sw", roles: [] } }
      });
      expect(output).toContain("Coder → Reviewer");
      expect(output).not.toContain("Plan:");
    });
  });
});

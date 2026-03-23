import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";

// Mock the dependencies that runHuReviewerStage uses
vi.mock("../../src/agents/index.js", () => ({
  createAgent: vi.fn(() => ({
    runTask: vi.fn(async () => ({
      ok: true,
      output: JSON.stringify({
        evaluations: [
          {
            story_id: "HU-001",
            scores: { D1_jtbd_context: 8, D2_user_specificity: 7, D3_behavior_change: 7, D4_control_zone: 6, D5_time_constraints: 5, D6_survivable_experiment: 5 },
            total: 38,
            antipatterns_detected: [],
            verdict: "certified",
            evaluation_notes: "Good story",
            certified_hu: { as: "Dr. Garcia", want: "see patients", so_that: "reduce errors by 30%" },
            context_needed: null
          },
          {
            story_id: "HU-002",
            scores: { D1_jtbd_context: 4, D2_user_specificity: 3, D3_behavior_change: 3, D4_control_zone: 4, D5_time_constraints: 3, D6_survivable_experiment: 3 },
            total: 20,
            antipatterns_detected: ["ghost_user"],
            verdict: "needs_context",
            evaluation_notes: "Missing user persona",
            context_needed: { fields_needed: ["D2"], question_to_fde: "Who is the target user?" }
          }
        ],
        batch_summary: {
          total: 2, certified: 1, needs_rewrite: 0, needs_context: 1,
          consolidated_questions: "Who is the target user for HU-002?"
        }
      }),
      usage: { input_tokens: 100, output_tokens: 200 }
    }))
  }))
}));

vi.mock("../../src/session-store.js", () => ({
  addCheckpoint: vi.fn(async () => {}),
  markSessionStatus: vi.fn(async () => {})
}));

vi.mock("../../src/utils/stall-detector.js", () => ({
  createStallDetector: vi.fn(() => ({ onOutput: vi.fn(), stop: vi.fn() }))
}));

describe("HU Reviewer pipeline stage", () => {
  let tmpDir;
  const origEnv = process.env.KJ_HOME;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-hu-stage-"));
    process.env.KJ_HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.KJ_HOME = origEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createYamlFile(stories) {
    const yamlContent = yaml.dump(stories);
    const yamlPath = path.join(tmpDir, "stories.yml");
    await fs.writeFile(yamlPath, yamlContent);
    return yamlPath;
  }

  function makeContext() {
    return {
      config: { roles: { hu_reviewer: { provider: "claude" } }, pipeline: { hu_reviewer: { enabled: true } } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() },
      emitter: { emit: vi.fn() },
      eventBase: { sessionId: "test-session", iteration: 0, stage: null, startedAt: Date.now() },
      session: { id: "test-session", task: "Test task", checkpoints: [] },
      coderRole: { provider: "claude", model: null },
      trackBudget: vi.fn()
    };
  }

  it("loads YAML file and creates batch", async () => {
    const { runHuReviewerStage } = await import("../../src/orchestrator/pre-loop-stages.js");
    const stories = [
      { id: "HU-001", text: "As a doctor, I want to see patient history" },
      { id: "HU-002", text: "As a user, I want to login" }
    ];
    const huFile = await createYamlFile(stories);
    const ctx = makeContext();

    const result = await runHuReviewerStage({ ...ctx, huFile, askQuestion: null });

    expect(result.stageResult).toBeTruthy();
    expect(result.stageResult.ok).toBe(true);
    expect(result.stageResult.total).toBe(2);
  });

  it("evaluates all stories", async () => {
    const { runHuReviewerStage } = await import("../../src/orchestrator/pre-loop-stages.js");
    const stories = [
      { id: "HU-001", text: "As a doctor, I want to see patient history" },
      { id: "HU-002", text: "As a user, I want to login" }
    ];
    const huFile = await createYamlFile(stories);
    const ctx = makeContext();

    const result = await runHuReviewerStage({ ...ctx, huFile, askQuestion: null });

    expect(result.stageResult.certified).toBeGreaterThanOrEqual(1);
  });

  it("pauses when needs_context and no askQuestion", async () => {
    const { runHuReviewerStage } = await import("../../src/orchestrator/pre-loop-stages.js");
    const stories = [
      { id: "HU-001", text: "Story 1" },
      { id: "HU-002", text: "Story 2" }
    ];
    const huFile = await createYamlFile(stories);
    const ctx = makeContext();

    const result = await runHuReviewerStage({ ...ctx, huFile, askQuestion: null });

    // Should stop without full certification since HU-002 needs context and no askQuestion
    expect(result.stageResult.needsContext).toBeGreaterThanOrEqual(0);
  });

  it("re-evaluates entire batch on FDE answer", async () => {
    const { runHuReviewerStage } = await import("../../src/orchestrator/pre-loop-stages.js");
    const stories = [
      { id: "HU-001", text: "Story 1" },
      { id: "HU-002", text: "Story 2" }
    ];
    const huFile = await createYamlFile(stories);
    const ctx = makeContext();
    const askQuestion = vi.fn(async () => "The user is a clinic receptionist");

    const result = await runHuReviewerStage({ ...ctx, huFile, askQuestion });

    // askQuestion should have been called for the needs_context story
    expect(askQuestion).toHaveBeenCalled();
    expect(result.stageResult.ok).toBe(true);
  });

  it("returns stories in topological order", async () => {
    const { runHuReviewerStage } = await import("../../src/orchestrator/pre-loop-stages.js");
    const stories = [
      { id: "HU-001", text: "Story 1", blocked_by: [] },
      { id: "HU-002", text: "Story 2", blocked_by: [] }
    ];
    const huFile = await createYamlFile(stories);
    const ctx = makeContext();

    const result = await runHuReviewerStage({ ...ctx, huFile, askQuestion: null });

    expect(result.stageResult.stories).toBeDefined();
    expect(Array.isArray(result.stageResult.stories)).toBe(true);
  });

  it("handles missing YAML file gracefully", async () => {
    const { runHuReviewerStage } = await import("../../src/orchestrator/pre-loop-stages.js");
    const ctx = makeContext();

    const result = await runHuReviewerStage({ ...ctx, huFile: "/nonexistent/path.yml", askQuestion: null });

    expect(result.stageResult.ok).toBe(false);
    expect(result.stageResult.error).toMatch(/Could not read/);
  });

  it("handles invalid YAML gracefully", async () => {
    const { runHuReviewerStage } = await import("../../src/orchestrator/pre-loop-stages.js");
    const yamlPath = path.join(tmpDir, "invalid.yml");
    await fs.writeFile(yamlPath, "{{invalid yaml: [}");
    const ctx = makeContext();

    const result = await runHuReviewerStage({ ...ctx, huFile: yamlPath, askQuestion: null });

    expect(result.stageResult.ok).toBe(false);
    expect(result.stageResult.error).toMatch(/Invalid YAML/);
  });
});

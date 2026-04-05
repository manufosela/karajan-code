import { describe, it, expect } from "vitest";
import { generateHuBatch, classifyTaskType, needsSetupHu } from "../src/hu/auto-generator.js";

describe("classifyTaskType", () => {
  it("maps setup/install → infra", () => {
    expect(classifyTaskType("Setup project structure")).toBe("infra");
    expect(classifyTaskType("Install dependencies")).toBe("infra");
    expect(classifyTaskType("Initialize workspaces")).toBe("infra");
    expect(classifyTaskType("Configure ESLint")).toBe("infra");
  });

  it("maps CI/CD → infra", () => {
    expect(classifyTaskType("Add Dockerfile and docker-compose")).toBe("infra");
    expect(classifyTaskType("Create GitHub Actions workflow.yml")).toBe("infra");
  });

  it("maps test-only tasks → add-tests", () => {
    expect(classifyTaskType("Write unit tests for auth")).toBe("add-tests");
    expect(classifyTaskType("Add coverage reporting")).toBe("add-tests");
  });

  it("does not misclassify feature tasks with 'test' mentioned", () => {
    expect(classifyTaskType("Implement login endpoint with test coverage")).toBe("sw");
  });

  it("maps docs → doc", () => {
    expect(classifyTaskType("Write README")).toBe("doc");
    expect(classifyTaskType("Add API documentation")).toBe("doc");
  });

  it("maps refactor → refactor", () => {
    expect(classifyTaskType("Refactor auth module")).toBe("refactor");
    expect(classifyTaskType("Cleanup unused imports")).toBe("refactor");
  });

  it("maps no-code → nocode", () => {
    expect(classifyTaskType("Setup Zapier automation")).toBe("nocode");
    expect(classifyTaskType("Configure Notion workspace")).toBe("nocode");
  });

  it("defaults unknown to sw", () => {
    expect(classifyTaskType("Implement realtime WebSocket sync")).toBe("sw");
    expect(classifyTaskType("Build login form component")).toBe("sw");
  });

  it("handles bad input", () => {
    expect(classifyTaskType(null)).toBe("sw");
    expect(classifyTaskType("")).toBe("sw");
    expect(classifyTaskType(123)).toBe("sw");
  });
});

describe("needsSetupHu", () => {
  it("true when project is new", () => {
    expect(needsSetupHu({ isNewProject: true })).toBe(true);
  });

  it("true when stack hints present", () => {
    expect(needsSetupHu({ stackHints: ["nodejs"] })).toBe(true);
  });

  it("true when subtasks mention frameworks", () => {
    expect(needsSetupHu({ subtasks: ["Use vitest for testing"] })).toBe(true);
    expect(needsSetupHu({ subtasks: ["Create Express server"] })).toBe(true);
  });

  it("false for existing project without stack hints", () => {
    expect(needsSetupHu({ subtasks: ["Fix auth bug"] })).toBe(false);
  });
});

describe("generateHuBatch", () => {
  const originalTask = "Build a REST API with auth and tests";
  const subtasks = [
    "Implement auth middleware with JWT",
    "Create user CRUD endpoints",
    "Write unit tests for auth"
  ];

  it("throws without originalTask", () => {
    expect(() => generateHuBatch({ subtasks })).toThrow(/originalTask/);
  });

  it("throws without subtasks", () => {
    expect(() => generateHuBatch({ originalTask })).toThrow(/subtasks/);
  });

  it("generates setup HU + task HUs for new project", () => {
    const batch = generateHuBatch({ originalTask, subtasks, isNewProject: true });
    expect(batch.total).toBe(4); // 1 setup + 3 tasks
    expect(batch.stories[0].id).toBe("HU-01");
    expect(batch.stories[0].task_type).toBe("infra");
    expect(batch.stories[0].title).toContain("Setup");
    expect(batch.stories[1].id).toBe("HU-02");
  });

  it("skips setup HU for existing projects without stack hints", () => {
    const batch = generateHuBatch({
      originalTask,
      subtasks: ["Fix auth bug", "Refactor user service"],
      isNewProject: false
    });
    expect(batch.total).toBe(2);
    expect(batch.stories[0].task_type).not.toBe("infra");
  });

  it("setup HU blocks all other HUs", () => {
    const batch = generateHuBatch({ originalTask, subtasks, isNewProject: true });
    expect(batch.stories[0].blocked_by).toEqual([]);
    expect(batch.stories[1].blocked_by).toContain("HU-01");
    expect(batch.stories[2].blocked_by).toContain("HU-01");
  });

  it("task HUs form linear chain after setup", () => {
    const batch = generateHuBatch({ originalTask, subtasks, isNewProject: true });
    // HU-02 depends only on setup
    expect(batch.stories[1].blocked_by).toEqual(["HU-01"]);
    // HU-03 depends on setup + HU-02
    expect(batch.stories[2].blocked_by).toEqual(["HU-01", "HU-02"]);
    // HU-04 depends on setup + HU-03
    expect(batch.stories[3].blocked_by).toEqual(["HU-01", "HU-03"]);
  });

  it("classifies each task HU by type", () => {
    const batch = generateHuBatch({ originalTask, subtasks, isNewProject: true });
    expect(batch.stories[1].task_type).toBe("sw"); // auth middleware
    expect(batch.stories[2].task_type).toBe("sw"); // CRUD
    expect(batch.stories[3].task_type).toBe("add-tests"); // unit tests
  });

  it("all generated stories are certified", () => {
    const batch = generateHuBatch({ originalTask, subtasks, isNewProject: true });
    for (const story of batch.stories) {
      expect(story.status).toBe("certified");
      expect(story.certified.text).toBeTruthy();
      expect(story.acceptance_criteria.length).toBeGreaterThan(0);
    }
  });

  it("flags batch as auto-generated with source metadata", () => {
    const batch = generateHuBatch({
      originalTask,
      subtasks,
      isNewProject: true,
      researcherContext: "some notes",
      architectContext: "some design"
    });
    expect(batch.generated).toBe(true);
    expect(batch.source.triage_subtasks).toBe(3);
    expect(batch.source.researcher).toBe(true);
    expect(batch.source.architect).toBe(true);
  });

  it("truncates long titles", () => {
    const longSubtask = "Implement " + "very ".repeat(20) + "long subtask description";
    const batch = generateHuBatch({ originalTask, subtasks: [longSubtask], isNewProject: false });
    expect(batch.stories[0].title.length).toBeLessThanOrEqual(80);
    expect(batch.stories[0].title).toContain("...");
  });

  it("includes stack hints in setup HU text", () => {
    const batch = generateHuBatch({
      originalTask,
      subtasks,
      isNewProject: true,
      stackHints: ["nodejs", "express", "vitest"]
    });
    const setupHu = batch.stories[0];
    expect(setupHu.certified.text).toContain("nodejs");
    expect(setupHu.certified.text).toContain("vitest");
  });
});

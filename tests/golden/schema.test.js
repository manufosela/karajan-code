import { describe, expect, it } from "vitest";
import { safeParseGoldenTask, parseGoldenTask } from "../../src/golden/schema.js";

const validTask = (overrides = {}) => ({
  id: "todo-rest-api",
  title: "Build a REST API for a todo list",
  prompt: "Build a REST API for a todo list. Express + Vitest.",
  expected_commits_min: 3,
  expected_audit_status: "pass",
  expected_test_files: ["tests/todo.test.js"],
  allowed_loc_range: [80, 250],
  ...overrides,
});

describe("golden/schema", () => {
  it("accepts a minimal valid task and applies the default timeout", () => {
    const r = safeParseGoldenTask(validTask());
    expect(r.ok).toBe(true);
    expect(r.task.timeout_minutes).toBe(30);
  });

  it("accepts the optional plan adherence threshold", () => {
    const r = safeParseGoldenTask(validTask({ expected_plan_adherence_min: 75 }));
    expect(r).toMatchObject({ ok: true, task: { expected_plan_adherence_min: 75 } });
  });

  it("rejects an empty prompt", () => {
    const r = safeParseGoldenTask(validTask({ prompt: "" }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "prompt")).toBe(true);
  });

  it("rejects an id with invalid characters", () => {
    const r = safeParseGoldenTask(validTask({ id: "Todo Task!" }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "id")).toBe(true);
  });

  it("rejects audit status outside the picklist", () => {
    expect(safeParseGoldenTask(validTask({ expected_audit_status: "great" })).ok).toBe(false);
  });

  it("rejects allowed_loc_range when min > max", () => {
    const r = safeParseGoldenTask(validTask({ allowed_loc_range: [200, 100] }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /min must be/.test(i.message))).toBe(true);
  });

  it("rejects plan adherence outside 0-100; parseGoldenTask throws on invalid input", () => {
    expect(safeParseGoldenTask(validTask({ expected_plan_adherence_min: -5 })).ok).toBe(false);
    expect(safeParseGoldenTask(validTask({ expected_plan_adherence_min: 101 })).ok).toBe(false);
    expect(() => parseGoldenTask({ id: "" })).toThrow();
  });
});

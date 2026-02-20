import { describe, expect, it } from "vitest";
import { normalizePlanArgs } from "../src/mcp/tool-arg-normalizers.js";

describe("normalizePlanArgs", () => {
  it("maps legacy coder aliases to planner fields", () => {
    const out = normalizePlanArgs({
      task: "plan this",
      coder: "claude",
      coderModel: "opus"
    });

    expect(out.planner).toBe("claude");
    expect(out.plannerModel).toBe("opus");
    expect(out.coder).toBeUndefined();
    expect(out.coderModel).toBeUndefined();
  });

  it("does not override explicit planner fields", () => {
    const out = normalizePlanArgs({
      task: "plan this",
      planner: "codex",
      plannerModel: "gpt-5.2-codex",
      coder: "claude",
      coderModel: "opus"
    });

    expect(out.planner).toBe("codex");
    expect(out.plannerModel).toBe("gpt-5.2-codex");
    expect(out.coder).toBeUndefined();
    expect(out.coderModel).toBeUndefined();
  });
});

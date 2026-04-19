import { describe, expect, it, vi } from "vitest";
import {
  StageExecutor,
  StageRegistry,
  runStage
} from "../../src/orchestrator/stages/stage-executor.js";

function makeStage(name, overrides = {}) {
  const stage = new StageExecutor(name);
  if (overrides.canRun) stage.canRun = overrides.canRun;
  if (overrides.execute) stage.execute = overrides.execute;
  if (overrides.onFailure) stage.onFailure = overrides.onFailure;
  return stage;
}

describe("StageExecutor — contract", () => {
  it("requires a non-empty name", () => {
    expect(() => new StageExecutor("")).toThrow(/non-empty name/);
    expect(() => new StageExecutor(null)).toThrow(/non-empty name/);
    expect(new StageExecutor("x").name).toBe("x");
  });

  it("default canRun returns true", () => {
    expect(new StageExecutor("x").canRun({})).toBe(true);
  });

  it("default execute throws (must be overridden)", async () => {
    await expect(new StageExecutor("x").execute({})).rejects.toThrow(/not implemented/);
  });

  it("default onFailure rethrows the original error", async () => {
    const stage = new StageExecutor("x");
    const err = new Error("boom");
    await expect(stage.onFailure(err, {})).rejects.toBe(err);
  });
});

describe("StageRegistry", () => {
  it("registers and retrieves stages by name", () => {
    const reg = new StageRegistry();
    const a = makeStage("a", { execute: async () => ({ status: "ok" }) });
    reg.register(a);
    expect(reg.size).toBe(1);
    expect(reg.has("a")).toBe(true);
    expect(reg.get("a")).toBe(a);
    expect(reg.list()).toEqual([a]);
  });

  it("rejects duplicate registration", () => {
    const reg = new StageRegistry();
    reg.register(makeStage("a"));
    expect(() => reg.register(makeStage("a"))).toThrow(/already registered/);
  });

  it("rejects non-StageExecutor values", () => {
    const reg = new StageRegistry();
    expect(() => reg.register({ name: "fake" })).toThrow(/must be a StageExecutor/);
  });

  it("preserves insertion order", () => {
    const reg = new StageRegistry();
    ["a", "b", "c"].forEach(n => reg.register(makeStage(n)));
    expect(reg.list().map(s => s.name)).toEqual(["a", "b", "c"]);
  });
});

describe("runStage", () => {
  it("invokes execute when canRun returns true", async () => {
    const execute = vi.fn(async () => ({ status: "ok", detail: "done" }));
    const stage = makeStage("x", { execute });
    const result = await runStage(stage, { foo: 1 });
    expect(execute).toHaveBeenCalledWith({ foo: 1 });
    expect(result).toEqual({ status: "ok", detail: "done" });
  });

  it("returns null and skips execute when canRun returns false", async () => {
    const execute = vi.fn();
    const stage = makeStage("x", { canRun: () => false, execute });
    const result = await runStage(stage, {});
    expect(result).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("awaits an async canRun", async () => {
    const execute = vi.fn(async () => ({ status: "ok" }));
    const stage = makeStage("x", {
      canRun: async () => false,
      execute
    });
    expect(await runStage(stage, {})).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("routes exceptions through onFailure and returns the recovered outcome", async () => {
    const recovered = { status: "ok", detail: "recovered" };
    const stage = makeStage("x", {
      execute: async () => { throw new Error("boom"); },
      onFailure: async () => recovered
    });
    expect(await runStage(stage, {})).toBe(recovered);
  });

  it("rethrows when onFailure also throws", async () => {
    const stage = makeStage("x", {
      execute: async () => { throw new Error("boom"); },
      onFailure: async (err) => { throw err; }
    });
    await expect(runStage(stage, {})).rejects.toThrow("boom");
  });

  it("rejects non-StageExecutor arguments", async () => {
    await expect(runStage({ name: "fake" }, {})).rejects.toThrow(/must be a StageExecutor/);
  });
});

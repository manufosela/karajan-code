import { describe, expect, it, vi } from "vitest";

import { createAutonomyAskQuestion } from "../../src/autonomy/stage-ask.js";

describe("createAutonomyAskQuestion", () => {
  it("interactive/assisted return the human ask unchanged", () => {
    const baseAsk = vi.fn();
    expect(createAutonomyAskQuestion({ baseAsk, autonomy: "interactive" })).toBe(baseAsk);
    expect(createAutonomyAskQuestion({ baseAsk, autonomy: "assisted" })).toBe(baseAsk);
  });

  it("autonomous never calls the human ask and never blocks", async () => {
    const baseAsk = vi.fn();
    const auto = createAutonomyAskQuestion({ baseAsk, autonomy: "autonomous", logger: { info: vi.fn() } });
    expect(auto).not.toBe(baseAsk);
    expect(auto.interactive).toBe(false);
    await auto("anything?", { stage: "tdd" });
    expect(baseAsk).not.toHaveBeenCalled();
  });

  it("answers per stage so existing branches proceed (architect→null, else→continue)", async () => {
    const auto = createAutonomyAskQuestion({ baseAsk: vi.fn(), autonomy: "autonomous", logger: { info: vi.fn() } });
    // architect: a truthy answer would force a wasteful re-run → null keeps it best-effort.
    expect(await auto("clarify?", { stage: "architect" })).toBeNull();
    // Solomon escalation / checkpoint: "continue" is parsed as free-text guidance → proceed.
    expect(await auto("resolve?", { stage: "tdd" })).toBe("continue");
    expect(await auto("checkpoint?", {})).toBe("continue");
  });
});

import { describe, expect, it, vi } from "vitest";

import { AUTONOMY_LEVELS, RISK, resolveAutonomy, usesArbiter } from "../../src/autonomy/policy.js";
import { createDecisionResolver } from "../../src/autonomy/decision-resolver.js";

const OPTIONS = [
  { value: "proceed", label: "Proceed" },
  { value: "block", label: "Block", conservative: true },
];

describe("resolveAutonomy", () => {
  it("defaults to interactive and honours flag > env > config precedence", () => {
    expect(resolveAutonomy()).toBe("interactive");
    expect(resolveAutonomy({ config: { autonomy: "assisted" } })).toBe("assisted");
    expect(resolveAutonomy({ config: { autonomy: "assisted" }, env: { KJ_AUTONOMY: "autonomous" } })).toBe("autonomous");
    expect(resolveAutonomy({ flags: { autonomy: "interactive" }, env: { KJ_AUTONOMY: "autonomous" } })).toBe("interactive");
    expect(resolveAutonomy({ flags: { autonomous: true } })).toBe("autonomous");
  });

  it("degrades an unknown level to the safe default", () => {
    expect(resolveAutonomy({ flags: { autonomy: "yolo" } })).toBe("interactive");
    expect(AUTONOMY_LEVELS).toContain("autonomous");
  });
});

describe("usesArbiter", () => {
  it("routes by level and risk", () => {
    expect(usesArbiter("interactive", RISK.LOW)).toBe(false);
    expect(usesArbiter("autonomous", RISK.HIGH)).toBe(true);
    expect(usesArbiter("assisted", RISK.LOW)).toBe(true);
    expect(usesArbiter("assisted", RISK.HIGH)).toBe(false); // high-risk → human
  });
});

describe("createDecisionResolver", () => {
  it("interactive asks the human and returns their answer", async () => {
    const ask = vi.fn().mockResolvedValue("proceed");
    const resolve = createDecisionResolver({ autonomy: "interactive", ask });
    expect(await resolve({ question: "Q?", options: OPTIONS })).toEqual({ choice: "proceed", rationale: "human", source: "human" });
    expect(ask).toHaveBeenCalledWith("Q?", null);
  });

  it("autonomous uses the arbiter's valid choice", async () => {
    const arbiter = vi.fn().mockResolvedValue({ choice: "proceed", rationale: "tests pass" });
    const resolve = createDecisionResolver({ autonomy: "autonomous", arbiter });
    expect(await resolve({ question: "Q?", options: OPTIONS })).toEqual({ choice: "proceed", rationale: "tests pass", source: "arbiter" });
  });

  it("autonomous degrades to the conservative option when the arbiter throws, returns garbage, or is absent", async () => {
    const throwing = createDecisionResolver({ autonomy: "autonomous", arbiter: vi.fn().mockRejectedValue(new Error("boom")), logger: { warn: vi.fn() } });
    expect((await throwing({ question: "Q?", options: OPTIONS })).choice).toBe("block");

    const garbage = createDecisionResolver({ autonomy: "autonomous", arbiter: vi.fn().mockResolvedValue({ choice: "nope" }) });
    expect((await garbage({ question: "Q?", options: OPTIONS })).source).toBe("fallback");

    const none = createDecisionResolver({ autonomy: "autonomous" });
    expect((await none({ question: "Q?", options: OPTIONS })).choice).toBe("block");
  });

  it("assisted escalates high-risk to the human but lets the arbiter take low-risk", async () => {
    const ask = vi.fn().mockResolvedValue("proceed");
    const arbiter = vi.fn().mockResolvedValue({ choice: "block" });
    const resolve = createDecisionResolver({ autonomy: "assisted", ask, arbiter });
    expect((await resolve({ question: "Q?", options: OPTIONS, risk: RISK.HIGH })).source).toBe("human");
    expect((await resolve({ question: "Q?", options: OPTIONS, risk: RISK.LOW })).source).toBe("arbiter");
  });
});

import { describe, expect, it } from "vitest";

import { AUTONOMY_LEVELS, RISK, resolveAutonomy, usesArbiter } from "../../src/autonomy/policy.js";

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

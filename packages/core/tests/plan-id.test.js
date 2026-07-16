import { describe, it, expect } from "vitest";
import { generatePlanId, generateHuId, normaliseAlias } from "../src/plan-id.js";

describe("karajan-core/plan-id", () => {
  it("generatePlanId returns plan-<ts>-<rand>", () => {
    const id = generatePlanId();
    expect(id).toMatch(/^plan-\d{14}-[a-z0-9]{4}$/);
  });

  it("generateHuId formats sequence zero-padded", () => {
    expect(generateHuId("plan-X", 1)).toBe("hu_plan-X_001");
    expect(generateHuId("plan-X", 42)).toBe("hu_plan-X_042");
  });

  it("normaliseAlias slugifies + caps to 60 chars", () => {
    expect(normaliseAlias("Greta App")).toBe("greta-app");
    expect(normaliseAlias("Café — Ñoño")).toBe("cafe-nono");
    expect(normaliseAlias("")).toBeNull();
    expect(normaliseAlias(null)).toBeNull();
  });
});

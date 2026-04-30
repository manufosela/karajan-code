import { describe, expect, it } from "vitest";
import { parseCanvas, safeParseCanvas } from "../../src/canvas/schema.js";

const minimalValid = {
  title: "Demo",
  requirements: { problem: "We need foo." },
  approach: "Build it.",
  structure: {},
  operations: [
    {
      title: "Step 1",
      acceptance: [{ type: "shell", content: "true" }],
    },
  ],
};

describe("CanvasSchema", () => {
  it("accepts a minimal valid canvas", () => {
    expect(() => parseCanvas(minimalValid)).not.toThrow();
  });

  it("rejects a canvas with no operations (empty array)", () => {
    expect(() => parseCanvas({ ...minimalValid, operations: [] })).toThrow();
  });

  it("rejects an operation without acceptance tests", () => {
    expect(() => parseCanvas({
      ...minimalValid,
      operations: [{ title: "Step", acceptance: [] }],
    })).toThrow();
  });

  it("rejects an acceptance test without type", () => {
    expect(() => parseCanvas({
      ...minimalValid,
      operations: [{ title: "Step", acceptance: [{ content: "true" }] }],
    })).toThrow();
  });

  it("rejects an acceptance test with unknown type", () => {
    expect(() => parseCanvas({
      ...minimalValid,
      operations: [{ title: "Step", acceptance: [{ type: "magic", content: "x" }] }],
    })).toThrow();
  });

  it("rejects empty title", () => {
    expect(() => parseCanvas({ ...minimalValid, title: "" })).toThrow();
  });

  it("rejects empty problem statement", () => {
    expect(() => parseCanvas({ ...minimalValid, requirements: { problem: "" } })).toThrow();
  });

  it("accepts optional sections (entities, norms, safeguards)", () => {
    expect(() => parseCanvas({
      ...minimalValid,
      entities: [{ name: "User", fields: ["id"] }],
      norms: ["No console.log"],
      safeguards: ["Order amount > 0"],
    })).not.toThrow();
  });

  it("safeParseCanvas returns success/failure without throwing", () => {
    expect(safeParseCanvas(minimalValid).success).toBe(true);
    expect(safeParseCanvas({ broken: "thing" }).success).toBe(false);
  });
});

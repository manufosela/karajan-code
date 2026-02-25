import { describe, expect, it } from "vitest";
import { RepeatDetector } from "../src/repeat-detector.js";

describe("RepeatDetector", () => {
  it("does not stall on first iteration", () => {
    const detector = new RepeatDetector();
    detector.addIteration([{ rule: "S-1", message: "Issue A" }], []);
    const result = detector.isStalled();
    expect(result.stalled).toBe(false);
  });

  it("does not stall when issues differ between iterations", () => {
    const detector = new RepeatDetector();
    detector.addIteration([{ rule: "S-1", message: "Issue A" }], []);
    detector.addIteration([{ rule: "S-2", message: "Issue B" }], []);
    const result = detector.isStalled();
    expect(result.stalled).toBe(false);
  });

  it("stalls when same SonarQube issues repeat", () => {
    const detector = new RepeatDetector();
    detector.addIteration([{ rule: "S-1", message: "Issue A" }], []);
    detector.addIteration([{ rule: "S-1", message: "Issue A" }], []);
    const result = detector.isStalled();
    expect(result.stalled).toBe(true);
    expect(result.reason).toBe("sonar_repeat");
  });

  it("stalls when same reviewer issues repeat", () => {
    const detector = new RepeatDetector();
    detector.addIteration([], [{ id: "R-1", description: "Fix failing test" }]);
    detector.addIteration([], [{ id: "R-1", description: "Fix failing test" }]);
    const result = detector.isStalled();
    expect(result.stalled).toBe(true);
    expect(result.reason).toBe("reviewer_repeat");
  });

  it("respects configured threshold", () => {
    const detector = new RepeatDetector({ threshold: 3 });
    detector.addIteration([{ rule: "S-1", message: "Issue A" }], []);
    detector.addIteration([{ rule: "S-1", message: "Issue A" }], []);
    expect(detector.isStalled().stalled).toBe(false);
    detector.addIteration([{ rule: "S-1", message: "Issue A" }], []);
    const result = detector.isStalled();
    expect(result.stalled).toBe(true);
  });
});

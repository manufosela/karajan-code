import { describe, expect, it } from "vitest";

import { buildOutcome, formatOutcomeReport } from "../../src/autonomy/outcome-report.js";

describe("buildOutcome", () => {
  it("marks DELIVERED with met counts and no defects when all HUs met the ask", () => {
    const o = buildOutcome({ planRef: "FEAT-1", delivered: true, hus: [{ id: "h1", met: true }, { id: "h2", met: true }] });
    expect(o).toMatchObject({ verdict: "DELIVERED", planRef: "FEAT-1", hus: { total: 2, met: 2, unmet: 0 }, residualDefects: [] });
  });

  it("marks INCOMPLETE and records residual defects from unmet HUs and decision defects", () => {
    const o = buildOutcome({
      planRef: "FEAT-2",
      delivered: false,
      hus: [{ id: "h1", met: true }, { id: "h2", met: false, note: "edge case unhandled" }],
      decisions: [{ verdict: "ACCEPT_WITH_DEFECT", rationale: "tests pass", hu: "h1", defect: "no retry on 5xx" }],
    });
    expect(o.verdict).toBe("INCOMPLETE");
    expect(o.hus).toMatchObject({ total: 2, met: 1, unmet: 1 });
    expect(o.residualDefects).toEqual([
      { hu: "h2", detail: "edge case unhandled" },
      { hu: "h1", detail: "no retry on 5xx" },
    ]);
  });
});

describe("formatOutcomeReport", () => {
  it("renders the verdict, HU tally, Arbiter decisions and known defects", () => {
    const o = buildOutcome({
      planRef: "FEAT-2",
      delivered: true,
      hus: [{ id: "h1", met: true }],
      decisions: [{ verdict: "ACCEPT_WITH_DEFECT", rationale: "tests pass", hu: "h1", defect: "no retry on 5xx" }],
    });
    const text = formatOutcomeReport(o).join("\n");
    expect(text).toContain("outcome: DELIVERED");
    expect(text).toContain("1/1 met the ask");
    expect(text).toContain("ACCEPT_WITH_DEFECT [h1] — tests pass");
    expect(text).toContain("[h1] no retry on 5xx");
  });

  it("states there are no residual defects when clean", () => {
    const text = formatOutcomeReport(buildOutcome({ planRef: "p", delivered: true, hus: [{ id: "h1", met: true }] })).join("\n");
    expect(text).toContain("No residual defects recorded.");
  });
});

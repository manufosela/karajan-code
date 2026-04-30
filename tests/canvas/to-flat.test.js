import { describe, expect, it } from "vitest";
import { canvasToTask } from "../../src/canvas/to-flat.js";

const FULL = {
  title: "Demo",
  requirements: { problem: "Need foo.", done: ["A", "B"] },
  entities: [{ name: "User", fields: ["id", "email"], notes: "primary key id" }],
  approach: "Saga pattern.",
  structure: { touches: ["src/auth/*"], depends_on: ["TokenService"], contracts: ["POST /auth"] },
  operations: [
    { title: "Step A", acceptance: [{ type: "shell", content: "true" }] },
    { title: "Step B", acceptance: [{ type: "gherkin", content: "Given X\nWhen Y\nThen Z" }] },
  ],
  norms: ["No console.log"],
  safeguards: ["Tokens never logged"],
};

describe("canvasToTask", () => {
  it("renders title + every section in canonical order", () => {
    const out = canvasToTask(FULL);
    expect(out).toMatch(/^# Demo/);
    // Headings in order
    const headings = out.match(/^## .+/gm);
    expect(headings).toEqual([
      "## Requirements",
      "## Entities",
      "## Approach",
      "## Structure",
      "## Operations",
      "## Norms (per-task engineering standards — coder MUST follow)",
      "## Safeguards (non-negotiable invariants — code MUST hold these)",
    ]);
  });

  it("preserves shell acceptance tests inline", () => {
    const out = canvasToTask(FULL);
    expect(out).toMatch(/- shell: `true`/);
  });

  it("preserves gherkin scenarios in fenced blocks (newlines survive)", () => {
    const out = canvasToTask(FULL);
    expect(out).toMatch(/```gherkin\n {5}Given X\n {5}When Y\n {5}Then Z\n {5}```/);
  });

  it("brackets Norms and Safeguards so prompts can locate them by regex", () => {
    const out = canvasToTask(FULL);
    expect(out).toMatch(/## Norms \(per-task engineering standards/);
    expect(out).toMatch(/## Safeguards \(non-negotiable invariants/);
  });

  it("omits Entities/Norms/Safeguards sections when arrays are empty", () => {
    const out = canvasToTask({
      ...FULL,
      entities: [],
      norms: [],
      safeguards: [],
    });
    expect(out).not.toMatch(/## Entities/);
    expect(out).not.toMatch(/## Norms/);
    expect(out).not.toMatch(/## Safeguards/);
  });

  it("renders Operations with numbered list + acceptance sub-bullets", () => {
    const out = canvasToTask(FULL);
    expect(out).toMatch(/^1\. Step A$/m);
    expect(out).toMatch(/^2\. Step B$/m);
    expect(out).toMatch(/^ {3}Acceptance:$/m);
  });

  it("includes file_hint and blocked_by when set", () => {
    const out = canvasToTask({
      ...FULL,
      operations: [
        { title: "X", file_hint: "src/x.js", blocked_by: ["op-1"], acceptance: [{ type: "shell", content: "true" }] },
      ],
    });
    expect(out).toMatch(/file: src\/x\.js/);
    expect(out).toMatch(/depends on: op-1/);
  });
});

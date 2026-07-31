// AB-C (KJC-TSK-0652): role briefs are the distilled METHOD of each role,
// exposed to the brain (any host agent). Not the subprocess prompts — those
// stay in headless. Briefs are agent context: concise by test, parameterized
// with the project's config where it changes what the role should do.
import { describe, it, expect } from "vitest";
import { BRIEF_ROLES, renderBrief, listBriefs } from "../../src/environment/briefs.js";

describe("renderBrief", () => {
  it("covers the roles the brain absorbs", () => {
    expect(BRIEF_ROLES).toEqual(
      expect.arrayContaining(["triage", "planner", "researcher", "architect", "tester", "security", "audit", "board"])
    );
  });

  // KJC-TSK-0670 (Jorge's dashboard fights): the board brief gives any
  // brain the board's model and its hard rule — cards are never deleted.
  it("board brief teaches permanence and the warning protocol", () => {
    const text = renderBrief("board", {});
    expect(text).toMatch(/NEVER deleted or recreated/);
    expect(text).toMatch(/kj hu move <id> skipped/);
    expect(text).toMatch(/kj report-issue/);
    expect(text).toMatch(/provenance intact/);
  });

  // AB-C2 (KJC-TSK-0653): outcome-first — briefs state Mission (what must
  // be true), Invariants (hard limits) and Deliverable. Never step lists:
  // frontier models pick better paths than a script; what they need
  // explicit are the limits.
  // KJC-TSK-0696: the alternatives clause lives where approaches are chosen.
  it("planner and architect carry the greenfield-alternative clause", () => {
    for (const role of ["planner", "architect"]) {
      expect(renderBrief(role, {})).toMatch(/as if the codebase didn'?t exist/i);
    }
    // KJC-TSK-0697: the architect grounds that alternative in the canon.
    expect(renderBrief("architect", {})).toMatch(/kj rag query --library/);
  });

  for (const role of ["triage", "planner", "researcher", "architect", "tester", "security", "audit"]) {
    it(`${role}: mission + invariants + deliverable, concise`, () => {
      const text = renderBrief(role, {});
      expect(text.length).toBeGreaterThan(150);
      expect(text.split("\n").length).toBeLessThanOrEqual(30);
      expect(text).toMatch(/Mission:/);
      expect(text).toMatch(/Invariants:/);
      expect(text).toMatch(/Deliverable:/);
      expect(text).not.toMatch(/^\s*\d+\.\s/m); // no numbered step scripts
    });
  }

  it("security brief carries the non-negotiable invariants", () => {
    const text = renderBrief("security", {});
    expect(text).toMatch(/secret/i);
    expect(text).toMatch(/injection|sanitiz/i);
    expect(text).toMatch(/never overridable|cannot be overridden/i);
  });

  it("tester brief keeps the TDD invariant tied to the configured methodology", () => {
    expect(renderBrief("tester", { development: { methodology: "tdd" } })).toMatch(/failing test .*first/i);
    expect(renderBrief("tester", { development: { methodology: "standard" } })).not.toMatch(/failing test .*first/i);
  });

  it("unknown role throws with the available list", () => {
    expect(() => renderBrief("dj", {})).toThrow(/triage/);
  });
});

describe("listBriefs", () => {
  it("returns one purpose line per role", () => {
    const list = listBriefs();
    expect(list).toHaveLength(BRIEF_ROLES.length);
    for (const entry of list) {
      expect(entry.role).toBeTruthy();
      expect(entry.purpose.length).toBeGreaterThan(10);
    }
  });
});

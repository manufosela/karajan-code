// AB-C (KJC-TSK-0652): role briefs are the distilled METHOD of each role,
// exposed to the brain (any host agent). Not the subprocess prompts — those
// stay in headless. Briefs are agent context: concise by test, parameterized
// with the project's config where it changes what the role should do.
import { describe, it, expect } from "vitest";
import { BRIEF_ROLES, renderBrief, listBriefs } from "../../src/environment/briefs.js";

describe("renderBrief", () => {
  it("covers the roles the brain absorbs", () => {
    expect(BRIEF_ROLES).toEqual(
      expect.arrayContaining(["triage", "planner", "researcher", "architect", "tester", "security", "audit"])
    );
  });

  for (const role of ["triage", "planner", "researcher", "architect", "tester", "security", "audit"]) {
    it(`${role}: actionable, concise, and names its output`, () => {
      const text = renderBrief(role, {});
      expect(text.length).toBeGreaterThan(200);
      expect(text.split("\n").length).toBeLessThanOrEqual(40);
      expect(text).toMatch(/## Output/);
    });
  }

  it("security brief carries the non-negotiables", () => {
    const text = renderBrief("security", {});
    expect(text).toMatch(/secret/i);
    expect(text).toMatch(/injection|sanitiz/i);
    expect(text).toMatch(/never overridable|cannot be overridden/i);
  });

  it("tester brief adapts to the configured methodology", () => {
    expect(renderBrief("tester", { development: { methodology: "tdd" } })).toMatch(/failing test FIRST/i);
    expect(renderBrief("tester", { development: { methodology: "standard" } })).not.toMatch(/failing test FIRST/i);
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

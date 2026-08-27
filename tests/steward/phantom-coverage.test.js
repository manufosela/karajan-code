// KJC-TSK-0800 PR-1 (epic KJC-PCS-0081) — phantom coverage is TWO detectors:
// a call graph for unit tests, and LITERAL crossing for E2E — the real GREBLA
// case a call graph cannot see: hierarchy.spec called no dead method, it
// looked for an aria-label that only existed inside an unreachable one.
import { describe, it, expect } from "vitest";
import { analyzeMemberReachability } from "../../src/audit/member-reachability.js";
import { detectPhantomUnit, detectPhantomE2E } from "../../src/steward/phantom-coverage.js";

// A component in GREBLA's shape: render() is live, _renderReportsTo() is not.
const SOURCE = `class Panel extends LitElement {
  render() { return this._rows(); }
  _rows() { return "Miembros del equipo"; }
  _renderReportsTo() { return "Head al que reporta"; }
}`;
const analysis = () => analyzeMemberReachability(SOURCE, { file: "panel.js" });

describe("detectPhantomUnit — the call graph", () => {
  it("a test whose only member calls hit unreachable code is a phantom, named by what it exercises", () => {
    const r = detectPhantomUnit({ sourceAnalysis: analysis(), testSource: `it("x", () => { const el = mount(); el._renderReportsTo(); expect(1).toBe(1); });`, file: "panel.test.js" });
    expect(r.observable).toBe(true);
    expect(r.phantoms).toEqual([expect.objectContaining({ member: "_renderReportsTo" })]);
  });
  it("one call to a LIVE member absolves the test — it covers something", () => {
    const r = detectPhantomUnit({ sourceAnalysis: analysis(), testSource: `it("x", () => { el._rows(); el._renderReportsTo(); });`, file: "t.js" });
    expect(r.phantoms).toEqual([]);
  });
  it("receivers bind weakly: a same-named call on ANOTHER object never gets the test accused", () => {
    const r = detectPhantomUnit({ sourceAnalysis: analysis(), testSource: `it("x", () => { other.somethingElse(); other._renderReportsTo(); });`, file: "t.js" });
    expect(r.phantoms).toEqual([]); // `other` also calls somethingElse — not bound to Panel
  });
  it("a not-observable analysis makes the detector not observable — no test is accused on an unreliable analysis", () => {
    const na = analyzeMemberReachability("class A extends Unknown { m() {} }", { file: "a.js" });
    const r = detectPhantomUnit({ sourceAnalysis: na, testSource: `it("x", () => el.m());`, file: "t.js" });
    expect(r.observable).toBe(false);
    expect(r.reason).toMatch(/not observable/i);
  });
});

describe("detectPhantomE2E — literal crossing (the case the call graph cannot see)", () => {
  it("a literal the test looks for that only lives inside unreachable code is a phantom, with the literal and where it lives", () => {
    const r = detectPhantomE2E({
      sourceText: SOURCE, sourceAnalysis: analysis(),
      testSource: `test("hierarchy", async ({ page }) => { await page.getByLabel("Head al que reporta").click(); });`,
      file: "hierarchy.spec.js",
    });
    expect(r.observable).toBe(true);
    expect(r.phantoms).toEqual([expect.objectContaining({ literal: "Head al que reporta" })]);
    expect(r.phantoms[0].line).toBeGreaterThan(0);
  });
  it("a literal that ALSO appears in reachable code is never reported — the test does cover something", () => {
    const r = detectPhantomE2E({
      sourceText: SOURCE, sourceAnalysis: analysis(),
      testSource: `test("rows", async ({ page }) => { await page.getByText("Miembros del equipo"); });`,
      file: "rows.spec.js",
    });
    expect(r.phantoms).toEqual([]);
  });
  it("inherits not-observable from the analysis", () => {
    const src = "class A extends Unknown { m() { return 'Etiqueta rara'; } }";
    const na = analyzeMemberReachability(src, { file: "a.js" });
    const r = detectPhantomE2E({ sourceText: src, sourceAnalysis: na, testSource: `t("x", () => find("Etiqueta rara"));`, file: "t.js" });
    expect(r.observable).toBe(false);
  });
});

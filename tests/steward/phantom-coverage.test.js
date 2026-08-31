// KJC-TSK-0800 PR-1 (epic KJC-PCS-0081) — phantom coverage is TWO detectors:
// a call graph for unit tests, and LITERAL crossing for E2E — the real GREBLA
// case a call graph cannot see: hierarchy.spec called no dead method, it
// looked for an aria-label that only existed inside an unreachable one.
import { describe, it, expect } from "vitest";
import { analyzeMemberReachability } from "../../src/audit/member-reachability.js";
import { detectPhantomUnit, detectPhantomE2E, assessTemporalSignature } from "../../src/steward/phantom-coverage.js";

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
    // KJC-BUG-0159 (GREBLA's field catch): file+line point at the TEST — that
    // is where the fix happens; the dead code's spot travels as sourceLine.
    expect(r.phantoms[0].file).toBe("hierarchy.spec.js");
    expect(r.phantoms[0].line).toBe(1); // the one-line spec
    expect(r.phantoms[0].sourceLine).toBe(4); // _renderReportsTo in the panel
  });
  it("a literal that ALSO appears in reachable code is never reported — the test does cover something", () => {
    const r = detectPhantomE2E({
      sourceText: SOURCE, sourceAnalysis: analysis(),
      testSource: `test("rows", async ({ page }) => { await page.getByText("Miembros del equipo"); });`,
      file: "rows.spec.js",
    });
    expect(r.phantoms).toEqual([]);
  });
  // KJC-BUG-0158 (GREBLA's field validation, 31-aug): the phantom that
  // MOTIVATED the detector was invisible to it — the code produces the label
  // interpolated (aria-label="Head al que reporta ${name}") and the test looks
  // for the RESOLVED string, so no exact literal matches. In Lit that is the
  // usual case, not the exception. A test literal that STARTS with a static
  // template chunk living only in unreachable code is a phantom.
  it("an interpolated label in dead code is caught by its static prefix — GREBLA's real case", () => {
    const src = "class Panel extends LitElement {\n  render() { return this._rows(); }\n  _rows() { return 1; }\n  _renderReportsTo(l) { return `<button aria-label=\"Head al que reporta ${l.displayName}\">x</button>`; }\n}";
    const a = analyzeMemberReachability(src, { file: "panel.js" });
    const r = detectPhantomE2E({
      sourceText: src, sourceAnalysis: a,
      testSource: `test("hierarchy", async ({ page }) => { await page.getByLabel("Head al que reporta Sin Head E2E").click(); });`,
      file: "hierarchy.spec.js",
    });
    expect(r.observable).toBe(true);
    expect(r.phantoms).toEqual([expect.objectContaining({ literal: "Head al que reporta Sin Head E2E" })]);
    expect(r.phantoms[0].line).toBe(1); // the spec's line — where the fix happens (KJC-BUG-0159)
    expect(r.phantoms[0].sourceLine).toBe(4); // the dead chunk in the panel
  });
  it("the same interpolated chunk ALSO in live code reports nothing — covering interpolation must not accuse live UI (GREBLA's acceptance)", () => {
    const src = "class Panel extends LitElement {\n  render() { return `<b aria-label=\"Head al que reporta ${this.x}\">y</b>`; }\n  _renderReportsTo(l) { return `<button aria-label=\"Head al que reporta ${l.displayName}\">x</button>`; }\n}";
    const a = analyzeMemberReachability(src, { file: "panel.js" });
    const r = detectPhantomE2E({ sourceText: src, sourceAnalysis: a, testSource: `t("x", () => page.getByLabel("Head al que reporta Sin Head E2E"));`, file: "s.spec.js" });
    expect(r.phantoms).toEqual([]);
  });
  it("the exact literal living in REACHABLE code absolves the prefix pass too — that test points at something alive", () => {
    const src = "class Panel extends LitElement {\n  render() { return `<b aria-label=\"Head al que reporta Sin Head E2E\">y</b>`; }\n  _renderReportsTo(l) { return `<button aria-label=\"Head al que reporta ${l.displayName}\">x</button>`; }\n}";
    const a = analyzeMemberReachability(src, { file: "panel.js" });
    const r = detectPhantomE2E({ sourceText: src, sourceAnalysis: a, testSource: `t("x", () => page.getByLabel("Head al que reporta Sin Head E2E"));`, file: "s.spec.js" });
    expect(r.phantoms).toEqual([]);
  });
  it("a short static chunk never matches by prefix — the threshold contains false positives", () => {
    const src = "class Panel extends LitElement {\n  render() {}\n  _dead() { return `<i title=\"Ver: ${this.x}\">z</i>`; }\n}";
    const a = analyzeMemberReachability(src, { file: "panel.js" });
    const r = detectPhantomE2E({ sourceText: src, sourceAnalysis: a, testSource: `t("x", () => page.getByTitle("Ver: algo concreto"));`, file: "s.spec.js" });
    expect(r.phantoms).toEqual([]);
  });
  it("inherits not-observable from the analysis", () => {
    const src = "class A extends Unknown { m() { return 'Etiqueta rara'; } }";
    const na = analyzeMemberReachability(src, { file: "a.js" });
    const r = detectPhantomE2E({ sourceText: src, sourceAnalysis: na, testSource: `t("x", () => find("Etiqueta rara"));`, file: "t.js" });
    expect(r.observable).toBe(false);
  });
});

// PR-2 — the temporal signature: zero static analysis, and it would have been
// enough for GREBLA. A bug gets fixed or reverted; a phantom fails the same
// way indefinitely because it proves something that no longer exists.
describe("assessTemporalSignature", () => {
  const DAY = 86_400_000;
  const now = Date.parse("2026-08-27T12:00:00Z");
  const fail = (test, reason, daysAgo) => ({ test, reason, at: new Date(now - daysAgo * DAY).toISOString() });
  it("a test failing the SAME way for longer than the threshold is suspected phantom, not bug", () => {
    const r = assessTemporalSignature({ failures: [fail("hierarchy.spec", "label not found", 21), fail("hierarchy.spec", "label not found", 10), fail("hierarchy.spec", "label not found", 1)], nowMs: now });
    expect(r.observable).toBe(true);
    expect(r.suspects).toEqual([expect.objectContaining({ test: "hierarchy.spec", days: 20 })]);
  });
  it("changing reasons look like a bug being worked, not a phantom", () => {
    const r = assessTemporalSignature({ failures: [fail("a.spec", "timeout", 10), fail("a.spec", "assert 3 != 4", 1)], nowMs: now });
    expect(r.suspects).toEqual([]);
  });
  it("a short streak is just a failure — below the threshold nothing is suspected", () => {
    const r = assessTemporalSignature({ failures: [fail("a.spec", "x", 2), fail("a.spec", "x", 1)], nowMs: now });
    expect(r.suspects).toEqual([]);
  });
  it("no history handed in: NOT OBSERVABLE — kj holds no per-test history, the source is injected and said", () => {
    const r = assessTemporalSignature({ failures: null });
    expect(r.observable).toBe(false);
    expect(r.reason).toMatch(/history/i);
  });
});

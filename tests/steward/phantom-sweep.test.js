// KJC-TSK-1343 — the sweep finds the test↔source pairs and runs the phantom
// detectors (KJC-TSK-0800) over them, so the steward invariant gets real output.
import { describe, it, expect } from "vitest";
import { sweepPhantoms } from "../../src/steward/phantom-sweep.js";

// GREBLA's shape: render() is live, _renderReportsTo() is not.
const PANEL = `import { LitElement } from "lit";
export class Panel extends LitElement {
  render() { return this._rows(); }
  _rows() { return "Miembros del equipo"; }
  _renderReportsTo() { return "Head al que reporta"; }
}`;
const sweep = (tree) => sweepPhantoms({ projectDir: "/repo", files: Object.keys(tree), read: (rel) => tree[rel] });

describe("sweepPhantoms", () => {
  it("a unit test that imports the component and only calls its dead member is a phantom", () => {
    const r = sweep({
      "src/panel.js": PANEL,
      "tests/panel.test.js": `import { Panel } from "../src/panel.js";\nit("x", () => { const el = new Panel(); el._renderReportsTo(); });`,
    });
    expect(r.observable).toBe(true);
    expect(r.phantoms).toEqual([expect.objectContaining({ member: "_renderReportsTo", file: "tests/panel.test.js" })]);
  });

  it("a spec looking for a literal that only lives in dead code is a phantom, pointing at the spec", () => {
    const r = sweep({
      "src/panel.js": PANEL,
      "e2e/hierarchy.spec.js": `test("h", async ({ page }) => {\n  await page.getByLabel("Head al que reporta").click();\n});`,
    });
    expect(r.phantoms).toEqual([expect.objectContaining({ literal: "Head al que reporta", file: "e2e/hierarchy.spec.js", line: 2 })]);
  });

  it("a literal that also appears in another source file is never accused", () => {
    const r = sweep({
      "src/panel.js": PANEL,
      "src/legend.js": `export const LABEL = "Head al que reporta";`,
      "e2e/hierarchy.spec.js": `test("h", async ({ page }) => { await page.getByLabel("Head al que reporta"); });`,
    });
    expect(r.observable).toBe(true);
    expect(r.phantoms).toEqual([]);
  });

  it("Lit components with nothing dead: observable and clean", () => {
    const live = `class A extends LitElement { render() { return "hola"; } }`;
    const r = sweep({ "src/a.js": live, "tests/a.test.js": `it("x", () => new A().render());` });
    expect(r).toEqual({ observable: true, phantoms: [] });
  });

  it("no Lit component: not observable, with the reason", () => {
    const r = sweep({ "src/util.js": "export const x = 1;", "tests/util.test.js": "it('x', () => {});" });
    expect(r.observable).toBe(false);
    expect(r.reason).toMatch(/Lit/);
  });

  it("outside a git repository: not observable, never clean", () => {
    const r = sweepPhantoms({ projectDir: "/repo", files: null, read: () => "" });
    expect(r.observable).toBe(false);
    expect(r.reason).toMatch(/git/);
  });
});

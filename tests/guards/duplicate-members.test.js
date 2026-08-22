// KJC-TSK-0796 — the guard that catches what JavaScript hides: a member declared
// twice, where the last one silently replaces the first. The real case comes from
// GREBLA (two `updated()` in a Lit component: a tab stayed empty for 17 days).
// A guard nobody has seen fail is a guard nobody knows works, so the first test
// IS the bug that motivated it.
import { describe, it, expect } from "vitest";
import { findDuplicateMembers } from "../../src/guards/duplicate-members.js";

const find = (src, file = "team-people.js") => findDuplicateMembers(src, { file });

describe("duplicate class members", () => {
  it("catches the real case and says WHAT WAS LOST, not just that there is a duplicate", () => {
    const { findings } = find(`class TeamPeople extends LitElement {
      updated(changed) { this.loadPeople(); }
      render() { return html\`<div></div>\`; }
      updated(changed) { super.updated(changed); }
    }`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ className: "TeamPeople", member: "updated", lostLine: 2, winnerLine: 4 });
    expect(findings[0].message).toContain("the updated of line 2 never runs");
  });

  it("does not cry wolf: get/set pairs, static vs instance, and different classes are all legal", () => {
    const { findings } = find(`class A {
      get value() { return this._v; }
      set value(v) { this._v = v; }
      static properties = { a: {} };
      properties = {};
      static styles = css\`\`;
    }
    class B { render() {} }
    class C { render() {} }`);
    expect(findings).toEqual([]);
  });

  it("reads modern syntax (private fields, static blocks) and chains a third copy to the second", () => {
    const { findings } = find(`class A {
      #secret = 1;
      static { A.ready = true; }
      secret() {}
      run() {}
      run() {}
      run() {}
    }`);
    expect(findings.map((f) => f.member)).toEqual(["run", "run"]);
    expect(findings.map((f) => [f.lostLine, f.winnerLine])).toEqual([[5, 6], [6, 7]]);
  });

  // The language already protects private names: declaring #x twice is a SyntaxError, not a silent
  // replacement. The file does not even compile, so reporting it as clean would be the worst answer.
  it("a duplicated private name is a syntax error, and that file is not observable either", () => {
    expect(find("class A { #s = 1; #s() {} }").notObservable.reason).toMatch(/could not be parsed/);
  });

  // TypeScript IS read (Babel's parser), and its overload signatures declare the same name on
  // purpose: flagging them would light up every overloaded method and get the guard switched off.
  it("reads TypeScript: overloads are not duplicates, a real duplicate still is", () => {
    const ts = `class Api {
      get(url: string): Promise<string>;
      get(url: string, raw: true): Promise<Buffer>;
      get(url: string, raw?: boolean) { return fetch(url) as never; }
      close() {}
      close() {}
    }`;
    const { findings } = find(ts, "api.ts");
    expect(findings.map((f) => f.member)).toEqual(["close"]);
  });

  it("what it cannot read is NOT OBSERVABLE, never clean: broken syntax and computed names", () => {
    expect(find("class A { this is not javascript", "broken.js").notObservable.reason).toMatch(/could not be parsed/);
    const computed = find(`class A { [name]() {} [other]() {} }`);
    expect(computed.findings).toEqual([]);
    expect(computed.notObservable.reason).toMatch(/computed at runtime/);
    // A file with a real duplicate is reported even if it also has computed names: the finding is certain.
    const both = find(`class A { [name]() {} run() {} run() {} }`);
    expect(both.findings).toHaveLength(1);
    expect(both.notObservable).toBeNull();
  });

  it("classes anywhere are checked, not only the first one of the file (GREBLA's hole 1)", () => {
    const { findings } = find(`export default function make() {
      return class { tick() {} tick() {} };
    }`);
    expect(findings).toHaveLength(1);
    expect(findings[0].className).toBe("(anonymous)");
  });
});

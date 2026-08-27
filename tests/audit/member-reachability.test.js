// KJC-TSK-0794 PR-A (epic KJC-PCS-0082) — member reachability inside the
// perimeter GREBLA validated by hand: one file, a recognized framework
// contract, no dynamic dispatch. Everything outside it must come out
// NOT OBSERVABLE with its reason — an inflated inventory gets switched off,
// and then nobody sees the dead code that IS real.
import { describe, it, expect } from "vitest";
import { analyzeMemberReachability, ENTRYPOINT_CATALOG } from "../../src/audit/member-reachability.js";

const lit = (body) => `class P extends LitElement { ${body} }`;
const deadOf = (res, i = 0) => res.classes[i].unreachable.map((u) => u.name);

describe("member reachability — the validated perimeter", () => {
  it("finds the member no entrypoint reaches, with its lines", () => {
    const res = analyzeMemberReachability(lit(`
      render() { return this._rows(); }
      _rows() { return this._fmt(1); }
      _fmt(x) { return x; }
      _dead() { return 1; }
    `));
    expect(res.observable).toBe(true);
    const c = res.classes[0];
    expect(c.observable).toBe(true);
    expect(c.framework).toBe("lit");
    expect(c.catalogVersion).toBe(ENTRYPOINT_CATALOG.version); // versioned catalog, cited per class
    expect(c.total).toBe(4);
    expect(c.unreachable).toEqual([expect.objectContaining({ name: "_dead", kind: "method" })]);
    expect(c.unreachable[0].line).toBeGreaterThan(0);
    expect(c.unreachable[0].endLine).toBeGreaterThanOrEqual(c.unreachable[0].line);
  });
  it("a static field initializer runs at class-definition time: what it touches is alive", () => {
    // `registry` itself stays a candidate (nobody reads it) — but `_build` ran,
    // in the STATIC slot: `this` in a static initializer is the class.
    expect(deadOf(analyzeMemberReachability(lit(`static registry = this._build(); render() {} static _build() {}`)))).toEqual(["static registry"]);
  });
  it("recursion does not keep itself alive, and this['literal'] IS a followable reference", () => {
    const res = analyzeMemberReachability(lit(`render() { this["_a"](); } _a() {} _loop() { this._loop(); }`));
    expect(deadOf(res)).toEqual(["_loop"]);
  });
  it("ONE computed access on this makes the WHOLE file not observable and yields no candidates", () => {
    const res = analyzeMemberReachability(lit(`render() { this[this.mode](); } _maybeDead() {}`));
    expect(res.observable).toBe(false);
    expect(res.reason).toMatch(/computed access on this at line \d+/);
    expect(res.classes).toEqual([]);
  });
  it("analyzes every class in the file, never silently only the first one", () => {
    const res = analyzeMemberReachability(`
      class A extends LitElement { render() { this._liveA(); } _liveA() {} _deadA() {} }
      class B extends LitElement { render() {} _deadB() {} }
    `);
    expect(res.classes.map((c) => c.name)).toEqual(["A", "B"]);
    expect(deadOf(res, 0)).toEqual(["_deadA"]);
    expect(deadOf(res, 1)).toEqual(["_deadB"]);
  });
  it("outside the contract — unknown base, mixin base, no base — is NOT OBSERVABLE with its reason, never analyzed wrong, never clean", () => {
    const cases = [
      ["class A extends Vista { pinta() {} }", /unknown base class Vista/],
      ["class A extends Mixin(LitElement) { render() {} }", /mixin/i],
      ["class A { helper() {} }", /outside the file/],
    ];
    for (const [src, reason] of cases) {
      const c = analyzeMemberReachability(src).classes[0];
      expect(c.observable).toBe(false);
      expect(c.reason).toMatch(reason);
      expect(c.unreachable).toEqual([]);
    }
  });
  it("a computed member NAME makes that class not observable — the inventory cannot name what it cannot see", () => {
    const res = analyzeMemberReachability(`const k = "x"; class A extends LitElement { [k]() {} render() {} }`);
    const c = res.classes[0];
    expect(c.observable).toBe(false);
    expect(c.reason).toMatch(/computed at line \d+/);
  });
  it("a file that cannot be parsed is NOT OBSERVABLE, never clean", () => {
    const res = analyzeMemberReachability("class {{{");
    expect(res.observable).toBe(false);
    expect(res.reason).toMatch(/not read as clean/);
  });
});

// PR-B1 — the refinement the PR-A arbitration queued: static and instance are
// different slots (an instance `this.foo` cannot run a static `foo`), plus the
// constructor fields the AST has no member for (AC5, the GREBLA gap).
describe("member reachability — static slots and constructor fields", () => {
  it("an instance this.X does not keep a static X alive: different slots, honest dead", () => {
    const res = analyzeMemberReachability(lit(`render() { this.helper(); } static helper() {} helper() {}`));
    expect(deadOf(res)).toEqual(["static helper"]);
  });
  it("a ClassName.X reference anywhere in the file is a static root", () => {
    const res = analyzeMemberReachability(`
      class P extends LitElement { render() {} static helper() {} }
      P.helper();
    `);
    expect(deadOf(res)).toEqual([]);
  });
  it("the catalog knows which entrypoints are static: styles lives as static, not by name collision", () => {
    const res = analyzeMemberReachability(lit(`static styles = this.base; static base = 1; render() {}`));
    expect(deadOf(res)).toEqual([]);
  });
  it("#private members flow through the normal analysis — keyName knows PrivateName, no bailout", () => {
    const res = analyzeMemberReachability(lit(`render() { this.#a(); } #a() {} #dead() {} static #sdead() {}`));
    expect(res.classes[0].observable).toBe(true);
    expect(deadOf(res)).toEqual(["#dead", "static #sdead"]);
  });
  it("a constructor field nobody reads is a write-only candidate, reported apart as the heuristic it is", () => {
    const res = analyzeMemberReachability(lit(`constructor() { super(); this._cache = null; } render() {}`));
    expect(res.classes[0].constructorFields).toEqual([expect.objectContaining({ name: "_cache" })]);
  });
  it("a constructor field that is read later is NOT a candidate", () => {
    const res = analyzeMemberReachability(lit(`constructor() { super(); this._cache = null; } render() { return this._cache; }`));
    expect(res.classes[0].constructorFields).toEqual([]);
  });
  it("a declared field assigned in the constructor is a member, not a constructor-field candidate", () => {
    const res = analyzeMemberReachability(lit(`_cache = 1; constructor() { super(); this._cache = null; } render() {}`));
    expect(res.classes[0].constructorFields).toEqual([]);
  });
});

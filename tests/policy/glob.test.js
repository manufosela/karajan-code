// PL-A (KJC-TSK-0733) — el primitivo glob de la policy: semántica pequeña,
// anclada y SIN sorpresas de lib general.
import { describe, it, expect } from "vitest";
import { globToRegExp, matchesAny } from "../../src/policy/glob.js";

describe("globToRegExp", () => {
  it("** cruza directorios, * no sale de su segmento, ? es un carácter", () => {
    expect(globToRegExp("src/**").test("src/a/b/c.js")).toBe(true);
    expect(globToRegExp("src/*.js").test("src/a.js")).toBe(true);
    expect(globToRegExp("src/*.js").test("src/a/b.js")).toBe(false);
    expect(globToRegExp("src/?.js").test("src/a.js")).toBe(true);
    expect(globToRegExp("src/?.js").test("src/ab.js")).toBe(false);
    expect(globToRegExp("src/**").test("srcx/a.js")).toBe(false);
  });

  it("**/ es prefijo de directorio OPCIONAL — casa en la raíz (reviewer catch)", () => {
    expect(globToRegExp("**/*.env*").test("deep/dir/.env.local")).toBe(true);
    expect(globToRegExp("**/*.env*").test(".env.local")).toBe(true);
  });

  it("los metacaracteres de regex del glob quedan inertes", () => {
    expect(globToRegExp("a+b(c).js").test("a+b(c).js")).toBe(true);
    expect(globToRegExp("a+b.js").test("aab.js")).toBe(false);
  });
});

describe("matchesAny", () => {
  it("lista válida casa; lista malformada (no-array) es false, nunca crash", () => {
    expect(matchesAny("src/a.js", ["docs/**", "src/**"])).toBe(true);
    expect(matchesAny("src/a.js", ["docs/**"])).toBe(false);
    expect(matchesAny("src/a.js", "src/**")).toBe(false);
    expect(matchesAny("src/a.js", undefined)).toBe(false);
  });
});

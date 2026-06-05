import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanText, collectAiSlop, CATEGORIES } from "../../src/audit/ai-slop-findings.js";

const has = (arr, cat) => arr.some((f) => f.category === cat);
const count = (arr, cat) => arr.filter((f) => f.category === cat).length;

describe("scanText — positive fixtures (one per category)", () => {
  it("flags a tautologic comment over a matching function decl", () => {
    const r = scanText("a.js", "// returns the user\nfunction getUser() { return null; }");
    expect(r.some((f) => f.category === "tautologic-comments" && f.line === 1)).toBe(true);
  });
  it("flags a banner-separator comment", () => {
    expect(has(scanText("a.js", "// =================== Section ==================="), "banner-separators")).toBe(true);
  });
  it("flags a boilerplate single-line docstring over matching decl", () => {
    expect(has(scanText("a.js", "/** Gets the user */\nexport function getUser() {}"), "boilerplate-docstrings")).toBe(true);
  });
  it("flags magic fallbacks to empty/null/undefined (?? and ||)", () => {
    expect(count(scanText("a.js", "const name = input ?? \"\";\nconst x = a || null;"), "magic-fallbacks")).toBe(2);
  });
  it("flags a redundant JSDoc @param description", () => {
    expect(has(scanText("a.js", " * @param {string} name - The name parameter"), "redundant-jsdoc")).toBe(true);
  });
});

describe("scanText — negative fixtures (must NOT flag)", () => {
  it("substantive comment is not tautologic", () => {
    const r = scanText("a.js", "// Aliased to satisfy the legacy callers that still expect snake_case.\nexport function getUser() {}");
    expect(count(r, "tautologic-comments")).toBe(0);
  });
  it("short separator (<5) is not a banner", () => {
    expect(count(scanText("a.js", "// --- div"), "banner-separators")).toBe(0);
  });
  it("substantive single-line docstring is not boilerplate", () => {
    const r = scanText("a.js", "/** Returns the canonical alias for backwards-compatibility with v1.x callers. */\nexport function getUser() {}");
    expect(count(r, "boilerplate-docstrings")).toBe(0);
  });
  it("fallback to a non-sentinel value is not magic", () => {
    expect(count(scanText("a.js", "const port = process.env.PORT ?? 4000;"), "magic-fallbacks")).toBe(0);
  });
  it("substantive JSDoc @param is not redundant", () => {
    expect(count(scanText("a.js", " * @param {string} name - human-readable display label"), "redundant-jsdoc")).toBe(0);
  });
});

describe("collectAiSlop — integration over tmp dir", () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "kj-aislop-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("returns {available, score, byCategory, worst} on a tmp repo", async () => {
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/slop.js"), [
      "// ============================ slop ============================",
      "// returns the user",
      "export function getUser() { return null ?? \"\"; }",
    ].join("\n"));
    writeFileSync(join(tmp, "src/clean.js"), "export function add(a, b) { return a + b; }");
    const r = await collectAiSlop(tmp);
    expect(r.available).toBe(true);
    expect(r.filesScanned).toBeGreaterThanOrEqual(2);
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.byCategory["banner-separators"]).toBeGreaterThanOrEqual(1);
    expect(r.byCategory["tautologic-comments"]).toBeGreaterThanOrEqual(1);
    expect(r.byCategory["magic-fallbacks"]).toBeGreaterThanOrEqual(1);
    expect(r.score).toBeLessThan(100);
    expect(Array.isArray(r.worst)).toBe(true);
    expect(r.worst[0]).toHaveProperty("path");
    expect(r.worst[0]).toHaveProperty("line");
    expect(r.worst[0]).toHaveProperty("category");
  });

  it("scores 100 on a clean repo with no tells", async () => {
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/clean.js"), "export function add(a, b) { return a + b; }\nexport function mul(a, b) { return a * b; }");
    const r = await collectAiSlop(tmp);
    expect(r.total).toBe(0);
    expect(r.score).toBe(100);
  });

  it("ignores node_modules / dist / .git / coverage", async () => {
    for (const dir of ["node_modules", "dist", ".git", "coverage"]) {
      mkdirSync(join(tmp, dir));
      writeFileSync(join(tmp, dir, "slop.js"), "// ====================== noise ======================");
    }
    const r = await collectAiSlop(tmp);
    expect(r.byCategory["banner-separators"]).toBe(0);
  });

  it("CATEGORIES contract: byCategory has exactly the 5 documented categories", async () => {
    const r = await collectAiSlop(tmp);
    expect(Object.keys(r.byCategory).sort()).toEqual([...CATEGORIES].sort());
  });
});

// KJC-BUG-0544 (#3788): files the repo marks linguist-generated leave Sonar and the budget.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { linguistGenerated } from "../../src/review/linguist-generated.js";
import { budgetedNet, countsTowardBudget } from "../../src/review/loc-budget.js";
import { sourceFilesOf } from "../../src/review/tests-with-code.js";

const LOCALE = "apps/web/src/generated/locales/es.js";
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function repo(attributes) {
  const cwd = mkdtempSync(join(tmpdir(), "kj-linguist-"));
  dirs.push(cwd);
  execFileSync("git", ["init", "-q", cwd]);
  for (const [path, text] of [[".gitattributes", attributes], [LOCALE, "export default {};\n"]]) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  execFileSync("git", ["-C", cwd, "add", ".gitattributes", LOCALE]);
  return cwd;
}

describe("linguistGenerated", () => {
  it("returns the staged files marked linguist-generated", () => {
    const cwd = repo("apps/web/src/generated/** linguist-generated\n");
    expect([...linguistGenerated([LOCALE, "src/a.js"], { cwd, cached: true })]).toEqual([LOCALE]);
  });

  it.each(["-linguist-generated", "linguist-generated=false"])("keeps %s counting as code", (attr) => {
    const cwd = repo(`apps/web/src/generated/** ${attr}\n`);
    expect(linguistGenerated([LOCALE], { cwd, cached: true }).size).toBe(0);
  });

  it("honours linguist-generated=true and an unmarked path stays code", () => {
    const cwd = repo("apps/web/src/generated/** linguist-generated=true\n");
    expect(linguistGenerated([LOCALE, "src/a.js"], { cwd, cached: true }).has("src/a.js")).toBe(false);
    expect(linguistGenerated([LOCALE], { cwd, cached: true }).has(LOCALE)).toBe(true);
  });

  it("says so and exempts nothing when git fails", () => {
    const said = [];
    const runner = () => { throw new Error("fatal: not a git repository"); };
    expect(linguistGenerated([LOCALE], { runner, warn: (m) => said.push(m) }).size).toBe(0);
    expect(said[0]).toMatch(/check-attr failed.*not a git repository/);
  });

  it("asks git once for all the files, with --cached on the staged path", () => {
    const calls = [];
    const runner = (_cwd, args) => { calls.push(args); return ""; };
    linguistGenerated(["a.js", "b.js"], { runner, cached: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["check-attr", "--cached", "-z", "linguist-generated", "--", "a.js", "b.js"]);
  });
});

describe("consumers of the generated set", () => {
  const generated = new Set([LOCALE]);

  it("a generated file is not a Sonar source, the same path without the mark is", () => {
    expect(sourceFilesOf({}, [LOCALE], generated).sources).toEqual([]);
    expect(sourceFilesOf({}, [LOCALE]).sources).toEqual([LOCALE]);
  });

  it("a generated file does not count toward the budget, and is said as exempt", () => {
    const numstat = [{ added: 300, removed: 0, from: LOCALE, to: LOCALE }];
    expect(countsTowardBudget(LOCALE, generated)).toBe(false);
    expect(countsTowardBudget(LOCALE)).toBe(true);
    expect(budgetedNet(numstat, undefined, generated)).toEqual({ net: 0, exempt: 300 });
    expect(budgetedNet(numstat).net).toBe(300);
  });

  it("an AI-rule file still counts even when the repo marks it generated", () => {
    const marked = new Set(["AGENTS.md", "templates/roles/coder.md"]);
    expect(countsTowardBudget("AGENTS.md", marked)).toBe(true);
    expect(countsTowardBudget("templates/roles/coder.md", marked)).toBe(true);
  });
});

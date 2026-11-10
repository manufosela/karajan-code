import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GEMINI_SETTINGS, installGeminiContext } from "../../src/harden/gemini-context.js";

let dir;
const settings = () => JSON.parse(readFileSync(join(dir, GEMINI_SETTINGS), "utf8"));
const seed = (value) => {
  mkdirSync(join(dir, ".gemini"), { recursive: true });
  writeFileSync(join(dir, GEMINI_SETTINGS), typeof value === "string" ? value : JSON.stringify(value));
};

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-gemini-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// KJC-TSK-1504: Gemini CLI reads GEMINI.md unless its settings name another file.
describe("installGeminiContext (KJC-TSK-1504)", () => {
  it("creates the settings naming AGENTS.md", () => {
    expect(installGeminiContext({ projectDir: dir })).toEqual({ file: GEMINI_SETTINGS, action: "inserted" });
    expect(settings()).toEqual({ context: { fileName: ["AGENTS.md"] } });
  });

  it("keeps every other setting and the files already named", () => {
    seed({ theme: "dark", context: { fileName: "NOTES.md", includeDirectories: ["docs"] } });
    expect(installGeminiContext({ projectDir: dir }).action).toBe("updated");
    expect(settings()).toEqual({ theme: "dark", context: { fileName: ["NOTES.md", "AGENTS.md"], includeDirectories: ["docs"] } });
  });

  it("is idempotent", () => {
    installGeminiContext({ projectDir: dir });
    const before = readFileSync(join(dir, GEMINI_SETTINGS), "utf8");
    expect(installGeminiContext({ projectDir: dir }).action).toBe("unchanged");
    expect(readFileSync(join(dir, GEMINI_SETTINGS), "utf8")).toBe(before);
  });

  for (const raw of ["{ not json", "null", "[]"]) {
    it(`does not rewrite settings it cannot use (${raw}), and says why`, () => {
      seed(raw);
      const res = installGeminiContext({ projectDir: dir });
      expect(res.action).toBe("skipped");
      expect(res.note).toMatch(/not valid JSON or not an object/);
      expect(readFileSync(join(dir, GEMINI_SETTINGS), "utf8")).toBe(raw);
    });
  }

  it("a dry run writes nothing", () => {
    expect(installGeminiContext({ projectDir: dir, dryRun: true }).action).toBe("inserted");
    expect(existsSync(join(dir, GEMINI_SETTINGS))).toBe(false);
  });
});

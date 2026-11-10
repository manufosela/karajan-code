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

  // KJC-TSK-1504: a repo whose pre-commit runs Prettier rejected the file kj had just written.
  describe("the layout follows the project's own Prettier", () => {
    /** A Prettier in node_modules whose CLI runs `body` with the text read from stdin as `input`. */
    const fakePrettier = (body) => {
      const pkg = join(dir, "node_modules", "prettier");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "prettier", bin: { prettier: "bin/cli.cjs" } }));
      mkdirSync(join(pkg, "bin"));
      writeFileSync(join(pkg, "bin", "cli.cjs"), `const input = require("node:fs").readFileSync(0, "utf8");\n${body}\n`);
    };

    it("without a Prettier, plain two-space JSON", () => {
      installGeminiContext({ projectDir: dir });
      expect(readFileSync(join(dir, GEMINI_SETTINGS), "utf8")).toBe(`${JSON.stringify({ context: { fileName: ["AGENTS.md"] } }, null, 2)}\n`);
    });

    it("with one, the text it gives back for .gemini/settings.json", () => {
      fakePrettier(String.raw`if (!process.argv.includes(".gemini/settings.json")) process.exit(2); process.stdout.write(JSON.stringify(JSON.parse(input), null, "\t") + "\n");`);
      expect(installGeminiContext({ projectDir: dir })).toEqual({ file: GEMINI_SETTINGS, action: "inserted" });
      expect(readFileSync(join(dir, GEMINI_SETTINGS), "utf8")).toBe('{\n\t"context": {\n\t\t"fileName": [\n\t\t\t"AGENTS.md"\n\t\t]\n\t}\n}\n');
    });

    it("a Prettier that fails leaves the plain JSON and says so", () => {
      fakePrettier('process.stderr.write("boom\\n"); process.exit(2);');
      const res = installGeminiContext({ projectDir: dir });
      expect(res.note).toMatch(/Prettier could not format it \(boom\)/);
      expect(JSON.parse(readFileSync(join(dir, GEMINI_SETTINGS), "utf8")).context.fileName).toEqual(["AGENTS.md"]);
    });
  });

  it("a dry run writes nothing", () => {
    expect(installGeminiContext({ projectDir: dir, dryRun: true }).action).toBe("inserted");
    expect(existsSync(join(dir, GEMINI_SETTINGS))).toBe(false);
  });
});

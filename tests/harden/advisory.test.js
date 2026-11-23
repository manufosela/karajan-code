import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildManagedBlock } from "../../src/utils/managed-markers.js";
import { compareHarden, findEquivalentIn, formatAdvisoryReport, UnreadableConfigError } from "../../src/harden/advisory.js";
import { findAlternative } from "../../src/harden/alternatives.js";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

// HU-4823: the real lookup, which one test overrides (no other tool stands in for ruff today).
vi.mock("../../src/harden/alternatives.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, findAlternative: vi.fn(real.findAlternative) };
});

let root;
const touch = (rel, content = "") => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
};
const run = () => compareHarden({ projectDir: root }).artifacts;
const find = (artifacts, id, dir = ".") => artifacts.find((a) => a.id === id && a.dir === dir);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-advisory-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  findAlternative.mockReset();
});

// KJC-BUG-0335 (#2094): the report compared configs only and said "0 missing" in a
// repo without the Sentinel, while the review gate demanded it: the report names
// the method's own pieces too.
describe("compareHarden — the method's own pieces", () => {
  it("names the Sentinel and the git hooks as missing, and as kept once installed", () => {
    // KJC-TSK-1208 (ADR 0030): the Sentinel is its wiring to the installed kj's guards.
    expect(find(run(), "sentinel")).toMatchObject({ status: "MISSING", recommendation: "install", file: ".claude/settings.json" });
    expect(find(run(), "git-hooks")).toMatchObject({ status: "MISSING", recommendation: "install", file: ".karajan/hooks/pre-commit" });
    installSentinelHooks({ projectDir: root, logger: { info() {}, warn() {} } });
    for (const f of ["hooks/pre-commit", "hooks/commit-msg"]) touch(`.karajan/${f}`, "x");
    expect(find(run(), "sentinel")).toMatchObject({ recommendation: "keep" });
    // A partial set is not installed: it names what is missing.
    expect(find(run(), "git-hooks")).toMatchObject({ recommendation: "install", missing: [".karajan/hooks/pre-push"] });
    touch(".karajan/hooks/pre-push", "x");
    expect(find(run(), "git-hooks")).toMatchObject({ recommendation: "keep" });
  });
});

describe("compareHarden", () => {
  // KJC-BUG-0201: commitlint joined the JS set, so like eslint it needs a JS
  // root to be in scope. The universal set keeps only what costs nothing in any
  // language (.editorconfig).
  it("reports MISSING for absent configs; JS configs need a package.json to be in scope", () => {
    expect(find(run(), "editorconfig")).toMatchObject({ status: "MISSING", recommendation: "install" });
    expect(find(run(), "eslint")).toBeUndefined();
    expect(find(run(), "commitlint")).toBeUndefined();
    touch("package.json", "{}");
    expect(find(run(), "eslint").status).toBe("MISSING");
    expect(find(run(), "commitlint").status).toBe("MISSING");
  });

  it("flags a kj:managed config as up to date, an old one for update", () => {
    touch("package.json", "{}"); // KJC-BUG-0201: commitlint is JS-scoped now
    touch("commitlint.config.js", buildManagedBlock({ blockId: "commitlint", version: 1, body: "export default {};", style: "slash" }));
    expect(find(run(), "commitlint")).toMatchObject({ status: "KJ_MANAGED", managedVersion: 1, upToDate: true, recommendation: "keep" });
    touch("commitlint.config.js", buildManagedBlock({ blockId: "commitlint", version: 0, body: "export default {};", style: "slash" }));
    expect(find(run(), "commitlint")).toMatchObject({ upToDate: false, recommendation: "update" });
  });

  it("lists concrete improvements for a thin USER_OWNED config", () => {
    touch("package.json", "{}");
    touch("commitlint.config.js", "export default { rules: {} };");
    const commitlint = find(run(), "commitlint");
    expect(commitlint).toMatchObject({ status: "USER_OWNED", recommendation: "review", mergeable: true });
    expect(commitlint.improvements.map((i) => i.id)).toEqual(["header-max-length", "subject-case"]);
  });

  it("keeps a USER_OWNED config that already covers the kj standard", () => {
    touch("package.json", "{}");
    touch("commitlint.config.js", 'rules: { "header-max-length": 1, "subject-case": 2 }');
    expect(find(run(), "commitlint")).toMatchObject({
      status: "USER_OWNED",
      recommendation: "keep",
      improvements: [],
      mergeable: false,
    });
  });

  it("recognizes equivalent formats (legacy eslintrc, package.json key) — no false MISSING", () => {
    touch("package.json", JSON.stringify({ prettier: { printWidth: 80 } }));
    touch(".eslintrc.json", '{ "rules": {} }');
    expect(find(run(), "eslint")).toMatchObject({ status: "USER_OWNED", foundAt: ".eslintrc.json" });
    expect(find(run(), "prettier")).toMatchObject({ status: "USER_OWNED", foundAt: "package.json#prettier" });
  });

  it("classifies each language root with a dir-prefixed path; output is serializable", () => {
    touch("frontend/package.json", "{}");
    touch("frontend/eslint.config.js", "export default [];");
    touch("backend/pyproject.toml", "");
    const artifacts = run();
    expect(find(artifacts, "eslint", "frontend")).toMatchObject({ status: "USER_OWNED", foundAt: join("frontend", "eslint.config.js") });
    expect(find(artifacts, "ruff", "backend").status).toBe("MISSING");
    expect(() => JSON.stringify(artifacts)).not.toThrow();
  });

  it("classifies eslint+prettier as SATISFIED_BY_ALTERNATIVE when biome.json is present (KJC-TSK-0614)", () => {
    touch("package.json", "{}");
    touch("biome.json", '{ "linter": { "enabled": true } }');
    const artifacts = run();
    for (const id of ["eslint", "prettier"]) {
      expect(find(artifacts, id)).toMatchObject({
        status: "SATISFIED_BY_ALTERNATIVE",
        foundAt: "biome.json",
        recommendation: "keep",
        mergeable: false,
      });
      expect(find(artifacts, id).rationale).toContain("biome");
    }
    // Biome does not cover commit-message linting — commitlint still proposed.
    expect(find(artifacts, "commitlint").status).toBe("MISSING");
  });

  it("the user's OWN eslint config wins over the biome alternative", () => {
    touch("package.json", "{}");
    touch("biome.json", "{}");
    touch(".eslintrc.json", '{ "rules": {} }');
    expect(find(run(), "eslint").status).toBe("USER_OWNED");
  });

  it("a root-level biome.json covers a monorepo language root", () => {
    touch("biome.jsonc", "{}");
    touch("frontend/package.json", "{}");
    const artifacts = run();
    expect(find(artifacts, "eslint", "frontend")).toMatchObject({
      status: "SATISFIED_BY_ALTERNATIVE",
      foundAt: "biome.jsonc",
    });
  });
});

describe("formatAdvisoryReport", () => {
  it("renders a line per artifact, indented improvements, and a tally", () => {
    touch("package.json", "{}");
    touch("commitlint.config.js", "export default { rules: {} };");
    const lines = formatAdvisoryReport(compareHarden({ projectDir: root }));
    const text = lines.join("\n");
    expect(text).toContain("advisory report (read-only)");
    expect(text).toMatch(/~ review\s+commitlint\.config\.js/);
    expect(text).toContain("      • caps the commit header at 100 chars");
    expect(lines.at(-1)).toMatch(/artifact\(s\) ·/);
  });

  it("handles an empty comparison (minimal profile)", () => {
    expect(formatAdvisoryReport({ artifacts: [] })[0]).toMatch(/nothing to compare/);
  });
});

// HU-4823: ruff reads pyproject.toml's [tool.ruff] tables, so findEquivalentIn must
// recognize them as the ruff config a seeded ruff.toml would shadow.
describe("findEquivalentIn — ruff (HU-4823)", () => {
  it("finds a [tool.ruff] table in pyproject.toml", () => {
    touch("pyproject.toml", "[tool.ruff]\nline-length = 120\n");
    expect(findEquivalentIn([root], "ruff")).toBe("pyproject.toml#tool.ruff");
  });

  it("finds a [tool.ruff.lint] sub-table", () => {
    touch("pyproject.toml", "[tool.ruff.lint]\nselect = ['E']\n");
    expect(findEquivalentIn([root], "ruff")).toBe("pyproject.toml#tool.ruff");
  });

  // TOML ignores whitespace around a table key and its dots, and a bare key may be quoted.
  it.each(["[ tool.ruff ]", "[tool.ruff ]", "[tool . ruff]", "[ tool.ruff.lint ]", '[tool."ruff"]', "[tool.'ruff']", '["tool".ruff]', "  [tool.ruff]  # ruff settings"])(
    "finds the table written as %s",
    (header) => {
      touch("pyproject.toml", `[project]\nname = 'x'\n\n${header}\nline-length = 120\n`);
      expect(findEquivalentIn([root], "ruff")).toBe("pyproject.toml#tool.ruff");
    },
  );

  // No table header at all, and ruff still reads them: only a TOML parser sees these.
  it.each([
    ["a dotted key under [tool]", "[tool]\nruff.line-length = 120\n"],
    ["a top-level dotted key", "tool.ruff.line-length = 120\n\n[project]\nname = 'x'\n"],
    ["an inline table", "[tool]\nruff = { line-length = 120 }\n"],
  ])("finds the table declared by %s", (_label, body) => {
    touch("pyproject.toml", body);
    expect(findEquivalentIn([root], "ruff")).toBe("pyproject.toml#tool.ruff");
  });

  it.each([
    ["ruff named only in a comment or a value", "[project]\nname = 'x'\n# [tool.ruff] lives elsewhere\ndescription = \"[tool.ruff]\"\n"],
    ["a table header inside a multi-line string", '[project]\nname = "x"\ndescription = """\n[tool.ruff]\n"""\n'],
    ["a look-alike table ([tool.ruffian])", "[tool.ruffian]\nx = 1\n"],
    ["another tool ([tool.ruff-lsp])", "[tool.ruff-lsp]\nx = 1\n"],
    ["a quoted key that only contains ruff", '[tool."ruff.lint"]\nx = 1\n'],
    // Ruff reads only a table there: any other TOML value configures nothing.
    ["a string, not a table", "[tool]\nruff = 'x'\n"],
    ["an array, not a table", "[tool]\nruff = ['E']\n"],
    ["an array of tables ([[tool.ruff]])", "[[tool.ruff]]\nx = 1\n"],
    ["a date, which parses to an object yet is no table", "[tool]\nruff = 1979-05-27\n"],
  ])("ignores %s", (_label, body) => {
    touch("pyproject.toml", body);
    expect(findEquivalentIn([root], "ruff")).toBeNull();
  });

  // Ruff itself cannot read such a file: kj cannot tell either, and says where it breaks.
  it("throws UnreadableConfigError, with the line, for a pyproject.toml that is not valid TOML", () => {
    touch("pyproject.toml", "[project]\nname = 'x'\n[tool.ruff\n");
    expect(() => findEquivalentIn([root], "ruff")).toThrow(UnreadableConfigError);
    expect(() => findEquivalentIn([root], "ruff")).toThrow(/pyproject\.toml is not readable TOML at line 3, column \d+, so/);
  });

  it("throws UnreadableConfigError, with the cause, for a pyproject.toml it cannot even read", () => {
    mkdirSync(join(root, "pyproject.toml"));
    expect(() => findEquivalentIn([root], "ruff")).toThrow(/pyproject\.toml is not readable TOML \(EISDIR\b.*\), so/);
  });

  it("compareHarden recommends keeping a ruff config it cannot read, never replacing it, and says why", () => {
    touch("pyproject.toml", "[tool.ruff\n");
    expect(find(run(), "ruff")).toMatchObject({ status: "UNREADABLE", recommendation: "keep", mergeable: false, foundAt: null });
    expect(find(run(), "ruff").rationale).toMatch(/pyproject\.toml is not readable TOML .*fix it, then re-run kj harden/);
  });

  // A file kj cannot read may be the user's own ruff config, and their own config wins over another tool.
  it("keeps the parse error when another tool would cover ruff", () => {
    findAlternative.mockImplementation((_dirs, id) => (id === "ruff" ? { tool: "other-linter", foundAt: "other-linter.toml" } : null));
    touch("pyproject.toml", "[tool.ruff\n");
    expect(find(run(), "ruff")).toMatchObject({ status: "UNREADABLE", recommendation: "keep", foundAt: null });
    expect(find(run(), "ruff").rationale).toMatch(/pyproject\.toml is not readable TOML/);
  });

  it("finds a .ruff.toml file", () => {
    touch(".ruff.toml", "line-length = 120\n");
    expect(findEquivalentIn([root], "ruff")).toBe(".ruff.toml");
  });

  it("returns null when there is no ruff config at all", () => {
    touch("pyproject.toml", "[project]\nname = 'x'\n");
    expect(findEquivalentIn([root], "ruff")).toBeNull();
  });
});

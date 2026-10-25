import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildManagedBlock } from "../../src/utils/managed-markers.js";
import { compareHarden, formatAdvisoryReport } from "../../src/harden/advisory.js";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

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

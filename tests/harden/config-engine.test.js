import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installConfigs } from "../../src/harden/config-engine.js";

let dir;
const read = (f) => readFileSync(join(dir, f), "utf8");

// KJC-BUG-0137: eslint/prettier configs only seed when their tool is actually
// installed — most fixtures here declare both so the classic behavior holds.
const withTools = (extra = {}) =>
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "x", devDependencies: { eslint: "^9", prettier: "^3" }, ...extra }),
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-cfg-"));
  withTools();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("installConfigs", () => {
  it("seeds editorconfig (markered), commitlint (markered) and prettier (json)", () => {
    const res = installConfigs({ projectDir: dir });
    expect(res.configs.every((c) => c.action === "inserted")).toBe(true);

    const ec = read(".editorconfig");
    expect(ec).toContain(">>> kj:managed:editorconfig v1 >>>");
    expect(ec).toContain("root = true");

    expect(read("commitlint.config.js")).toContain("config-conventional");
    expect(JSON.parse(read(".prettierrc.json"))).toMatchObject({ printWidth: 110 });
  });

  it("is idempotent on the markered files", () => {
    installConfigs({ projectDir: dir });
    const res = installConfigs({ projectDir: dir });
    const ec = res.configs.find((c) => c.file === ".editorconfig");
    expect(ec.action).toBe("unchanged");
  });

  it("never overwrites a user-authored config without our marker", () => {
    writeFileSync(join(dir, ".editorconfig"), "root = true\n[*]\nindent_size = 4\n");
    const res = installConfigs({ projectDir: dir });
    expect(res.configs.find((c) => c.file === ".editorconfig").action).toBe("skipped");
    expect(read(".editorconfig")).toContain("indent_size = 4");
    expect(read(".editorconfig")).not.toContain("kj:managed");
  });

  it("leaves a pre-existing prettier json untouched (seed-only)", () => {
    writeFileSync(join(dir, ".prettierrc.json"), '{"printWidth":80}');
    const res = installConfigs({ projectDir: dir });
    expect(res.configs.find((c) => c.file === ".prettierrc.json").action).toBe("skipped");
    expect(JSON.parse(read(".prettierrc.json")).printWidth).toBe(80);
  });

  it("dry-run writes nothing", () => {
    const res = installConfigs({ projectDir: dir, dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(existsSync(join(dir, ".editorconfig"))).toBe(false);
    expect(existsSync(join(dir, ".prettierrc.json"))).toBe(false);
  });

  // KJC-BUG-0119 (field, 2026-07-21): harden created eslint.config.js in a
  // Next.js repo that already had eslint.config.mjs — ESLint resolves .js
  // BEFORE .mjs, so the generated file silently eclipsed the project's real
  // linting. Any same-tool variant must count as "the config exists".
  it("never seeds eslint.config.js next to eslint.config.mjs (KJC-BUG-0119)", () => {
    writeFileSync(join(dir, "eslint.config.mjs"), "export default [];\n");
    const res = installConfigs({ projectDir: dir, language: "javascript" });
    const eslintEntry = res.configs.find((c) => c.file === "eslint.config.js");
    expect(eslintEntry).toMatchObject({ action: "covered", by: "eslint.config.mjs" });
    expect(existsSync(join(dir, "eslint.config.js"))).toBe(false);
  });

  it("covers legacy .eslintrc.json and inline package.json config too", () => {
    writeFileSync(join(dir, ".eslintrc.json"), "{}");
    withTools({ prettier: { printWidth: 80 } });
    const res = installConfigs({ projectDir: dir, language: "javascript" });
    const byFile = Object.fromEntries(res.configs.map((c) => [c.file, c]));
    expect(byFile["eslint.config.js"]).toMatchObject({ action: "covered", by: ".eslintrc.json" });
    expect(byFile[".prettierrc.json"]).toMatchObject({ action: "covered", by: "package.json#prettier" });
    expect(existsSync(join(dir, "eslint.config.js"))).toBe(false);
    expect(existsSync(join(dir, ".prettierrc.json"))).toBe(false);
  });

  it("covers a YAML commitlint config (.commitlintrc.yml) instead of seeding", () => {
    writeFileSync(join(dir, ".commitlintrc.yml"), "extends: ['@commitlint/config-conventional']\n");
    const res = installConfigs({ projectDir: dir, language: "javascript" });
    const byFile = Object.fromEntries(res.configs.map((c) => [c.file, c]));
    expect(byFile["commitlint.config.js"]).toMatchObject({ action: "covered", by: ".commitlintrc.yml" });
    expect(existsSync(join(dir, "commitlint.config.js"))).toBe(false);
  });

  it("still seeds when no variant of the tool exists", () => {
    writeFileSync(join(dir, "eslint.config.mjs"), "export default [];\n");
    const res = installConfigs({ projectDir: dir, language: "javascript" });
    // prettier has no variant here → seeds normally alongside the mjs eslint.
    expect(res.configs.find((c) => c.file === ".prettierrc.json").action).toBe("inserted");
  });

  // KJC-BUG-0137 (issue #1357): a lint/format config whose tool isn't even
  // installed is decorative at best — and pairs with a hook/workflow demand
  // the project can't satisfy. kj never generates a demand it didn't leave
  // satisfied: no eslint/prettier in the project ⇒ no config, with the
  // actionable install command in the report instead.
  it("omits eslint/prettier configs when the tool is not installed (KJC-BUG-0137)", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    const res = installConfigs({ projectDir: dir, language: "javascript" });
    const byFile = Object.fromEntries(res.configs.map((c) => [c.file, c]));
    expect(byFile["eslint.config.js"].action).toBe("omitted");
    expect(byFile["eslint.config.js"].note).toContain("npm i -D eslint");
    expect(byFile[".prettierrc.json"].action).toBe("omitted");
    expect(existsSync(join(dir, "eslint.config.js"))).toBe(false);
    expect(existsSync(join(dir, ".prettierrc.json"))).toBe(false);
    // Tool-independent configs are untouched by the gate.
    expect(byFile[".editorconfig"].action).toBe("inserted");
  });

  it("a tool present only via node_modules/.bin still counts as installed", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", ".bin", "eslint"), "");
    const res = installConfigs({ projectDir: dir, language: "javascript" });
    expect(res.configs.find((c) => c.file === "eslint.config.js").action).toBe("inserted");
  });

  it("never seeds eslint/prettier next to biome.json (KJC-TSK-0614)", () => {
    writeFileSync(join(dir, "biome.json"), "{}");
    const res = installConfigs({ projectDir: dir, language: "javascript" });
    const byFile = Object.fromEntries(res.configs.map((c) => [c.file, c]));
    expect(byFile[".prettierrc.json"]).toMatchObject({ action: "covered", by: "biome.json" });
    expect(existsSync(join(dir, ".prettierrc.json"))).toBe(false);
    const eslintEntry = res.configs.find((c) => c.file.includes("eslint"));
    expect(eslintEntry).toMatchObject({ action: "covered", by: "biome.json" });
    expect(existsSync(join(dir, eslintEntry.file))).toBe(false);
    // Biome does not replace editorconfig/commitlint — those still seed.
    expect(byFile[".editorconfig"].action).toBe("inserted");
    expect(byFile["commitlint.config.js"].action).toBe("inserted");
  });
});

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installConfigsForRoots } from "../../src/harden/config-engine.js";
import { detectStackRoots } from "../../src/harden/stack-roots.js";

let root;
const has = (rel) => existsSync(join(root, rel));
const seed = (rel, content = "") => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), content);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-cfgroots-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("installConfigsForRoots (monorepo)", () => {
  it("seeds universal at root and each language inside its own root", () => {
    seed("frontend/package.json", '{"devDependencies":{"eslint":"^9","prettier":"^3"}}');
    seed("backend/pyproject.toml", "");
    const roots = detectStackRoots(root);
    const res = installConfigsForRoots({ projectDir: root, roots });

    // Universal at the repo root, once.
    expect(has(".editorconfig")).toBe(true);
    expect(has("commitlint.config.js")).toBe(true);

    // JS tooling only in frontend/, Python tooling only in backend/.
    expect(has(join("frontend", "eslint.config.js"))).toBe(true);
    expect(has(join("frontend", ".prettierrc.json"))).toBe(true);
    expect(has(join("backend", "ruff.toml"))).toBe(true);
    expect(has("eslint.config.js")).toBe(false);
    expect(has("ruff.toml")).toBe(false);
    expect(has(join("backend", "eslint.config.js"))).toBe(false);

    const files = res.configs.map((c) => c.file);
    expect(files).toContain(join("frontend", "eslint.config.js"));
    expect(files).toContain(join("backend", "ruff.toml"));
  });

  it("with no roots seeds only the universal set", () => {
    const res = installConfigsForRoots({ projectDir: root, roots: [] });
    expect(res.configs.map((c) => c.file).sort()).toEqual([".editorconfig", "commitlint.config.js"]);
  });

  it("dry-run writes nothing", () => {
    seed("frontend/package.json", '{"devDependencies":{"eslint":"^9","prettier":"^3"}}');
    const roots = detectStackRoots(root);
    installConfigsForRoots({ projectDir: root, roots, dryRun: true });
    expect(has(".editorconfig")).toBe(false);
    expect(has(join("frontend", "eslint.config.js"))).toBe(false);
  });
});

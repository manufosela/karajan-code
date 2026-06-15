import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectStackRoots, matchesGlob } from "../../src/harden/stack-roots.js";

let root;
const touch = (rel, content = "") => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-roots-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("detectStackRoots", () => {
  it("returns nothing for an empty project", () => {
    expect(detectStackRoots(root)).toEqual([]);
  });

  it("detects a single language at the root", () => {
    touch("package.json", "{}");
    expect(detectStackRoots(root)).toEqual([{ dir: ".", language: "javascript" }]);
  });

  it("flags typescript when tsconfig is present", () => {
    touch("package.json", "{}");
    touch("tsconfig.json", "{}");
    expect(detectStackRoots(root)).toEqual([{ dir: ".", language: "typescript" }]);
  });

  it("detects php from composer.json", () => {
    touch("composer.json", "{}");
    expect(detectStackRoots(root)).toEqual([{ dir: ".", language: "php" }]);
  });

  it("detects each side of a fullstack monorepo", () => {
    touch("frontend/package.json", "{}");
    touch("backend/pyproject.toml", "");
    expect(detectStackRoots(root)).toEqual([
      { dir: "backend", language: "python" },
      { dir: "frontend", language: "javascript" },
    ]);
  });

  it("handles a root JS workspace plus a python service", () => {
    touch("package.json", "{}");
    touch("services/api/go.mod", "module x");
    expect(detectStackRoots(root)).toEqual([
      { dir: ".", language: "javascript" },
      { dir: join("services", "api"), language: "go" },
    ]);
  });

  it("keeps only the shallowest dir per language", () => {
    touch("package.json", "{}");
    touch("apps/web/package.json", "{}");
    expect(detectStackRoots(root)).toEqual([{ dir: ".", language: "javascript" }]);
  });

  it("never descends into noise dirs", () => {
    touch("node_modules/somepkg/package.json", "{}");
    touch("dist/package.json", "{}");
    expect(detectStackRoots(root)).toEqual([]);
  });

  it("ignores demo/fixture dirs by default (KJC-TSK-0564)", () => {
    touch("package.json", "{}");
    touch("examples/dni-validator/package.json", "{}");
    touch("wrappers/python/pyproject.toml", "");
    // examples/* is ignored; wrappers/* is not auto-ignored (needs a flag).
    expect(detectStackRoots(root)).toEqual([
      { dir: ".", language: "javascript" },
      { dir: join("wrappers", "python"), language: "python" },
    ]);
  });

  it("--exclude drops a language root by dir prefix", () => {
    touch("package.json", "{}");
    touch("wrappers/python/pyproject.toml", "");
    expect(detectStackRoots(root, { exclude: ["wrappers"] })).toEqual([
      { dir: ".", language: "javascript" },
    ]);
  });

  it("--only restricts to the named roots", () => {
    touch("frontend/package.json", "{}");
    touch("backend/pyproject.toml", "");
    expect(detectStackRoots(root, { only: ["backend"] })).toEqual([
      { dir: "backend", language: "python" },
    ]);
  });
});

describe("matchesGlob", () => {
  it("matches exact and directory-prefix", () => {
    expect(matchesGlob("wrappers", "wrappers")).toBe(true);
    expect(matchesGlob("wrappers/python", "wrappers")).toBe(true);
    expect(matchesGlob("wrappersx", "wrappers")).toBe(false);
  });

  it("honours * wildcards anchored at both ends", () => {
    expect(matchesGlob("packages/ai-trash", "packages/*")).toBe(true);
    expect(matchesGlob("apps/web", "packages/*")).toBe(false);
    expect(matchesGlob("anything", "*")).toBe(true);
  });
});

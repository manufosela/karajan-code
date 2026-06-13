import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectStackRoots } from "../../src/harden/stack-roots.js";

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
});

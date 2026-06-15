import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildManagedBlock } from "../../src/utils/managed-markers.js";
import { compareHarden } from "../../src/harden/advisory.js";

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

describe("compareHarden", () => {
  it("reports MISSING for absent configs; JS configs need a package.json to be in scope", () => {
    expect(find(run(), "commitlint")).toMatchObject({ status: "MISSING", recommendation: "install" });
    expect(find(run(), "eslint")).toBeUndefined();
    touch("package.json", "{}");
    expect(find(run(), "eslint").status).toBe("MISSING");
  });

  it("flags a kj:managed config as up to date, an old one for update", () => {
    touch("commitlint.config.js", buildManagedBlock({ blockId: "commitlint", version: 1, body: "export default {};", style: "slash" }));
    expect(find(run(), "commitlint")).toMatchObject({ status: "KJ_MANAGED", managedVersion: 1, upToDate: true, recommendation: "keep" });
    touch("commitlint.config.js", buildManagedBlock({ blockId: "commitlint", version: 0, body: "export default {};", style: "slash" }));
    expect(find(run(), "commitlint")).toMatchObject({ upToDate: false, recommendation: "update" });
  });

  it("treats a user's own config as USER_OWNED, kept by default", () => {
    touch("commitlint.config.js", "export default { rules: {} };");
    expect(find(run(), "commitlint")).toMatchObject({ status: "USER_OWNED", recommendation: "keep" });
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
});

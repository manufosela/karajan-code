import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installWorkflows } from "../../src/harden/workflow-engine.js";

// KJC-BUG-0529 (#3661): the Quality workflow reads Node version and test script from the repo.
let dir;
const put = (rel, text) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const pkg = (scripts, extra = {}) => put("package.json", JSON.stringify({ scripts, ...extra }));
const quality = (opts = {}) => {
  const res = installWorkflows({ projectDir: dir, language: "javascript", ...opts });
  const wf = res.workflows.find((w) => w.file.endsWith("kj-quality.yml"));
  return { text: readFileSync(join(dir, wf.file), "utf8"), note: wf.note };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-qi-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Quality workflow Node version", () => {
  it("uses .nvmrc, prefixed with the root when the app lives in a subdirectory", () => {
    pkg({ test: "x" });
    put(".nvmrc", "24\n");
    const { text, note } = quality();
    expect(text).toContain("node-version-file: .nvmrc");
    expect(text).not.toContain("node-version: 22");
    expect(note).toBeUndefined();
    rmSync(join(dir, ".nvmrc"));
    put("app/package.json", JSON.stringify({ scripts: { test: "x" } }));
    put("app/.nvmrc", "24\n");
    expect(quality({ root: "app" }).text).toContain("node-version-file: app/.nvmrc");
  });

  it("uses engines.node through package.json", () => {
    pkg({ test: "x" }, { engines: { node: ">=24" } });
    expect(quality().text).toContain("node-version-file: package.json");
  });

  it("reuses the literal of the repo's own workflows, never kj's", () => {
    pkg({ test: "x" });
    put(".github/workflows/ci.yml", "jobs:\n  a:\n    steps:\n      - with:\n          node-version: '24.22.1'\n");
    put(".github/workflows/kj-other.yml", "node-version: 18\n");
    expect(quality().text).toContain("node-version: 24.22.1");
  });

  it("falls back to 22 with a note on an expression", () => {
    pkg({ test: "x" });
    put(".github/workflows/ci.yml", "          node-version: ${{ matrix.node }}\n");
    const { text, note } = quality();
    expect(text).toContain("node-version: 22");
    expect(note).toContain("using 22");
  });
});

describe("Quality workflow test step", () => {
  it("runs test:unit through the pm when there is no test script", () => {
    pkg({ "test:unit": "x" });
    const { text } = quality();
    expect(text).toContain("npm run -s test:unit");
    expect(text).not.toContain("npm test");
  });

  it("runs test:unit through yarn itself in a Yarn repo (Plug'n'Play has no node_modules for npm)", () => {
    pkg({ "test:unit": "x" }, { packageManager: "yarn@4.5.0" });
    const { text } = quality();
    expect(text).toContain("      - run: yarn run test:unit");
    expect(text).not.toContain("npm run");
  });

  it("runs test:unit through pnpm in a pnpm repo, never through npm", () => {
    pkg({ "test:unit": "x" }, { packageManager: "pnpm@9.12.0" });
    const { text } = quality();
    expect(text).toContain("      - run: pnpm run -s test:unit\n");
    expect(text).not.toMatch(/\bnpm (?:run|test)/);
  });

  it("runs no tests, with a note, when there is neither", () => {
    pkg({ lint: "x" });
    const { text, note } = quality();
    expect(text).not.toMatch(/npm test|test:unit/);
    expect(note).toContain("runs no tests");
  });

  it("renders today's output for no files and a test script", () => {
    pkg({ test: "x" });
    const { text } = quality();
    expect(text).toContain("node-version: 22\n");
    expect(text).toContain("      - run: npm test");
  });
});

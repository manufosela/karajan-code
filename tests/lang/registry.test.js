// KJC-PCS-0052 PR-A — registry de adapters: detección por manifest +
// matchers (isCodeFile / shouldSkip). Repo legacy sin manifest cae a JS
// para preservar el comportamiento pre-PR.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildMatchers,
  detectAdaptersForProject,
  getAdapters,
  getAllCodeExtensions,
} from "../../src/lang/registry.js";

function mkRoot() {
  return mkdtempSync(join(tmpdir(), "kj-lang-"));
}

describe("language registry — KJC-PCS-0052 PR-A", () => {
  it("getAdapters returns a defensive copy", () => {
    const a = getAdapters();
    const b = getAdapters();
    expect(a).not.toBe(b);
    expect(a.map((x) => x.id).sort()).toEqual(["go", "js", "python", "rust"]);
  });

  it("only Python, Rust and Go adapters expose prepare() (JS uses sync @babel)", () => {
    const byId = Object.fromEntries(getAdapters().map((a) => [a.id, a]));
    expect(typeof byId.python.prepare).toBe("function");
    expect(typeof byId.rust.prepare).toBe("function");
    expect(typeof byId.go.prepare).toBe("function");
    expect(byId.js.prepare).toBeUndefined();
  });

  it("getAllCodeExtensions includes JS, Python, Rust and Go", () => {
    const exts = getAllCodeExtensions();
    expect(exts).toContain(".js");
    expect(exts).toContain(".ts");
    expect(exts).toContain(".py");
    expect(exts).toContain(".rs");
    expect(exts).toContain(".go");
  });

  it("detects Go via go.mod", () => {
    const root = mkRoot();
    writeFileSync(join(root, "go.mod"), "module example.com/x\n");
    const adapters = detectAdaptersForProject(root);
    expect(adapters.map((a) => a.id)).toEqual(["go"]);
  });

  it("detects Rust via Cargo.toml", () => {
    const root = mkRoot();
    writeFileSync(join(root, "Cargo.toml"), "[package]\nname='x'\n");
    const adapters = detectAdaptersForProject(root);
    expect(adapters.map((a) => a.id)).toEqual(["rust"]);
  });

  it("detects JS via package.json", () => {
    const root = mkRoot();
    writeFileSync(join(root, "package.json"), "{}");
    const adapters = detectAdaptersForProject(root);
    expect(adapters.map((a) => a.id)).toEqual(["js"]);
  });

  it("detects Python via pyproject.toml", () => {
    const root = mkRoot();
    writeFileSync(join(root, "pyproject.toml"), "[project]\nname='x'\n");
    const adapters = detectAdaptersForProject(root);
    expect(adapters.map((a) => a.id)).toEqual(["python"]);
  });

  it("detects multi-stack repos (JS + Python manifests both present)", () => {
    const root = mkRoot();
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "requirements.txt"), "requests\n");
    const ids = detectAdaptersForProject(root).map((a) => a.id).sort();
    expect(ids).toEqual(["js", "python"]);
  });

  it("falls back to JS when no manifest is recognised (legacy / sandbox)", () => {
    const root = mkRoot();
    const adapters = detectAdaptersForProject(root);
    expect(adapters.map((a) => a.id)).toEqual(["js"]);
  });

  it("buildMatchers unions extensions and skipSegments across active adapters", () => {
    const root = mkRoot();
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "pyproject.toml"), "");
    const m = buildMatchers(detectAdaptersForProject(root));
    expect(m.isCodeFile("/x/main.py")).toBe(true);
    expect(m.isCodeFile("/x/main.ts")).toBe(true);
    expect(m.isCodeFile("/x/README.md")).toBe(false);
    // skipSegments: comunes (.git, dist, .karajan) + JS (node_modules) + Python (__pycache__, .venv).
    expect(m.shouldSkip("/x/.git/config")).toBe(true);
    expect(m.shouldSkip("/x/node_modules/foo/index.js")).toBe(true);
    expect(m.shouldSkip("/x/__pycache__/foo.pyc")).toBe(true);
    expect(m.shouldSkip("/x/.venv/lib/python3.11/site.py")).toBe(true);
    expect(m.shouldSkip("/x/src/main.py")).toBe(false);
  });

  it("Python-only repo: matcher does NOT pull in JS skipSegments", () => {
    const root = mkRoot();
    writeFileSync(join(root, "pyproject.toml"), "");
    const m = buildMatchers(detectAdaptersForProject(root));
    expect(m.isCodeFile("/x/main.py")).toBe(true);
    expect(m.isCodeFile("/x/main.js")).toBe(false);
    expect(m.shouldSkip("/x/node_modules/foo/index.js")).toBe(false);
    expect(m.shouldSkip("/x/__pycache__/foo.pyc")).toBe(true);
  });
});

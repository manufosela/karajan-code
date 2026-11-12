// HU-4049 (KJC-TSK-1559 b): kj-quality.yml gets one job per stack root.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requiredChecksFrom } from "../../src/harden/branch-protection.js";
import { installWorkflows } from "../../src/harden/workflow-engine.js";

let dir;
const quality = () => readFileSync(join(dir, ".github", "workflows", "kj-quality.yml"), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const pkg = (rel, json) => {
  mkdirSync(join(dir, rel), { recursive: true });
  writeFileSync(join(dir, rel, "package.json"), JSON.stringify(json));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-wf-roots-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("kj-quality.yml with one stack root (golden: byte-identical to before HU-4049)", () => {
  it("a typescript root at the repo root", () => {
    pkg(".", { name: "x", private: true, scripts: { lint: "eslint .", test: "vitest run" } });
    installWorkflows({ projectDir: dir, roots: [{ dir: ".", language: "typescript" }] });
    expect(sha(quality())).toBe("460f42904770c486ffc93edba56cc0c142e18235dbd563bf53225caa3193c82d");
  });

  it("one nested javascript root runs in its dir", () => {
    pkg("app", { name: "x", private: true, scripts: { lint: "eslint ." } });
    writeFileSync(join(dir, "app", "pnpm-lock.yaml"), "");
    installWorkflows({ projectDir: dir, roots: [{ dir: "app", language: "javascript" }] });
    expect(sha(quality())).toBe("1aa15639adb3f8c429106aa9c7f4ab563fe2780acbd8c70d9e09ac3416dff879");
  });
});

describe("kj-quality.yml with several stack roots", () => {
  const roots = [
    { dir: ".", language: "typescript" },
    { dir: "api", language: "python" },
    { dir: "android", language: "kotlin" },
  ];

  it("one job per root with a template, each with its own setup and working directory", () => {
    pkg(".", { name: "x", private: true, packageManager: "pnpm@9.0.0", scripts: { lint: "eslint .", test: "vitest run" } });
    installWorkflows({ projectDir: dir, roots });
    const text = quality();
    const { jobs } = yaml.load(text);
    expect(Object.keys(jobs)).toEqual(["quality-root", "quality-api"]);
    expect(jobs["quality-root"].name).toBe("quality (.)");
    expect(jobs["quality-root"].defaults).toBeUndefined();
    expect(jobs["quality-root"].steps.map((s) => s.run).filter(Boolean)).toEqual(["corepack enable", "pnpm install --frozen-lockfile", "pnpm run -s lint", "pnpm test"]);
    expect(jobs["quality-api"].name).toBe("quality (api)");
    expect(jobs["quality-api"].defaults).toEqual({ run: { "working-directory": "api" } });
    expect(jobs["quality-api"].steps.map((s) => s.run).filter(Boolean)).toEqual(["pip install ruff pytest", "ruff check .", "pytest"]);
    expect(text).not.toContain("android");
  });

  it("branch protection is told each job's check name", () => {
    installWorkflows({ projectDir: dir, roots });
    expect(requiredChecksFrom(dir)).toContain("quality (.)");
    expect(requiredChecksFrom(dir)).toContain("quality (api)");
    expect(requiredChecksFrom(dir)).not.toContain("quality");
  });

  it("roots whose job ids collide still get one job each", () => {
    installWorkflows({ projectDir: dir, roots: ["foo/bar", "foo-bar-3", "foo.bar"].map((d) => ({ dir: d, language: "python" })) });
    const { jobs } = yaml.load(quality());
    expect(Object.entries(jobs).map(([id, job]) => [id, job.name])).toEqual([
      ["quality-foo-bar", "quality (foo/bar)"],
      ["quality-foo-bar-3", "quality (foo-bar-3)"],
      ["quality-foo-bar-2", "quality (foo.bar)"],
    ]);
  });
});

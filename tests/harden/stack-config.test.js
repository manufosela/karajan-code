import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installConfigs } from "../../src/harden/config-engine.js";

let dir;
const has = (f) => existsSync(join(dir, f));
const read = (f) => readFileSync(join(dir, f), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-stack-"));
  // KJC-BUG-0137: JS configs only seed when their tool is installed.
  writeFileSync(join(dir, "package.json"), '{"devDependencies":{"eslint":"^9","prettier":"^3"}}');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("installConfigs is stack-aware", () => {
  it("python seeds ruff (with pyupgrade) + universal, never JS tooling", () => {
    installConfigs({ projectDir: dir, language: "python" });
    expect(has("ruff.toml")).toBe(true);
    expect(read("ruff.toml")).toContain(">>> kj:managed:ruff v1 >>>");
    expect(read("ruff.toml")).toContain('"UP"');
    expect(has(".editorconfig")).toBe(true);
    expect(has("commitlint.config.js")).toBe(true);
    expect(has("eslint.config.js")).toBe(false);
    expect(has(".prettierrc.json")).toBe(false);
  });

  it("go seeds golangci + universal, no JS tooling", () => {
    installConfigs({ projectDir: dir, language: "go" });
    expect(read(".golangci.yml")).toContain("staticcheck");
    expect(has("eslint.config.js")).toBe(false);
  });

  it("php seeds phpstan + universal, no JS tooling", () => {
    installConfigs({ projectDir: dir, language: "php" });
    expect(read("phpstan.neon")).toContain("level: 6");
    expect(has("eslint.config.js")).toBe(false);
  });

  it("an unknown language gets only the universal set (no tooling imposed)", () => {
    const res = installConfigs({ projectDir: dir, language: "ruby" });
    expect(res.configs.map((c) => c.file).sort()).toEqual([".editorconfig", "commitlint.config.js"]);
    expect(has("ruff.toml")).toBe(false);
    expect(has("eslint.config.js")).toBe(false);
  });

  it("javascript still seeds the full JS set", () => {
    installConfigs({ projectDir: dir, language: "javascript" });
    expect(has("eslint.config.js")).toBe(true);
    expect(has(".prettierrc.json")).toBe(true);
  });
});

// KJC-TSK-0384 PR 1 — Onboarder collectors acceptance pins (A..F).
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectTree, collectGitHistory, collectConfigs, collectAdrs, collectAll,
} from "../../src/onboarder/collectors/index.js";

function gitInit(dir) {
  execFileSync("git", ["init", "--quiet"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir, stdio: "pipe" });
}

describe("onboarder/collectors — KJC-TSK-0384 PR 1", () => {
  let root;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kj-onboard-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("A) collectTree walks dirs and ignores node_modules + .git", async () => {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.js"), "console.log('a')");
    mkdirSync(join(root, "node_modules", "x"), { recursive: true });
    writeFileSync(join(root, "node_modules", "x", "skip.js"), "skip");
    const tree = await collectTree(root);
    const paths = tree.map((e) => e.path);
    expect(paths).toContain("src");
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("B) collectGitHistory returns null on a plain directory (greenfield)", () => {
    expect(collectGitHistory(root)).toBeNull();
  });

  it("C) collectGitHistory returns commitCount + headSha on a real repo", () => {
    gitInit(root);
    writeFileSync(join(root, "x.txt"), "x");
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "seed", "--quiet"], { cwd: root, stdio: "pipe" });
    const g = collectGitHistory(root);
    expect(g.commitCount).toBe(1);
    expect(g.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("D) collectConfigs reports package.json presence and reads scripts", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest", lint: "eslint ." } }));
    const c = collectConfigs(root);
    expect(c.present).toContain("package.json");
    expect(c.scripts.test).toBe("vitest");
  });

  it("E) collectAdrs finds ADR-style filenames under docs/adr", async () => {
    mkdirSync(join(root, "docs", "adr"), { recursive: true });
    writeFileSync(join(root, "docs", "adr", "0001-use-postgres.md"), "# ADR 1");
    writeFileSync(join(root, "docs", "adr", "0002-prefer-async.md"), "# ADR 2");
    writeFileSync(join(root, "docs", "adr", "README.md"), "index");
    const adrs = await collectAdrs(root);
    expect(adrs.length).toBe(2);
    expect(adrs.some((p) => p.endsWith("0001-use-postgres.md"))).toBe(true);
  });

  it("F) collectAll degrades gracefully on greenfield + present fields", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
    const b = await collectAll(root);
    expect(b.projectDir).toBe(root);
    expect(b.git).toBeNull(); // greenfield: no git
    expect(b.configs.present).toContain("package.json");
    expect(Array.isArray(b.tree)).toBe(true);
    expect(Array.isArray(b.adrs)).toBe(true);
    expect(b.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

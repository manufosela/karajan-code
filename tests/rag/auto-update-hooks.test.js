// KJC-TSK-0455 PR2 — installPostMergeHook + maybeAutoUpdate skip paths.
// The "ran" path of maybeAutoUpdate is covered indirectly by the
// indexProjectDelta tests in auto-update.test.js; here we only assert
// the cheap branches so the suite stays hermetic (no embedder boot).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installPostMergeHook, maybeAutoUpdate } from "../../src/rag/auto-update.js";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("installPostMergeHook — KJC-TSK-0455", () => {
  let root, projectDir;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-hook-"));
    projectDir = join(root, "proj");
    mkdirSync(projectDir, { recursive: true });
  });

  it("throws on a non-git directory", () => {
    expect(() => installPostMergeHook({ projectDir, logger: noopLogger })).toThrow(/Not a git repository/);
  });

  it("writes an executable hook with the KJC-TSK-0455 marker on a fresh repo", async () => {
    await execa("git", ["-C", projectDir, "init", "-q"]);
    const r = installPostMergeHook({ projectDir, logger: noopLogger });
    expect(r.installed).toBe(true);
    const body = readFileSync(r.target, "utf8");
    expect(body).toMatch(/KJC-TSK-0455/);
    expect(statSync(r.target).mode & 0o111).toBeTruthy();
  });

  it("includes the QMD reindex block (KJC-TSK-0507) gated on indexable paths", async () => {
    await execa("git", ["-C", projectDir, "init", "-q"]);
    const r = installPostMergeHook({ projectDir, logger: noopLogger });
    const body = readFileSync(r.target, "utf8");
    expect(body).toMatch(/KJC-TSK-0507/);
    expect(body).toMatch(/command -v qmd/);
    expect(body).toMatch(/qmd update/);
    expect(body).toMatch(/docs\/\|\\\.reviews\/\|\\\.karajan\/plans\//);
    expect(body).toMatch(/\(qmd update[^\n]*\) &/);
    expect(body).toMatch(/git diff-tree -r --name-only ORIG_HEAD HEAD/);
  });

  it("leaves a pre-existing user hook untouched", async () => {
    await execa("git", ["-C", projectDir, "init", "-q"]);
    const hooks = join(projectDir, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    const target = join(hooks, "post-merge");
    writeFileSync(target, "#!/bin/sh\necho user-hook\n");
    const r = installPostMergeHook({ projectDir, logger: noopLogger });
    expect(r.skipped).toBe(true);
    expect(readFileSync(target, "utf8")).toMatch(/user-hook/);
  });
});

describe("maybeAutoUpdate skip paths — KJC-TSK-0455", () => {
  let root, projectDir;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-auto-"));
    projectDir = join(root, "proj");
    mkdirSync(projectDir, { recursive: true });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("skips when --no-rag-update is set", async () => {
    const r = await maybeAutoUpdate({ projectDir, config: {}, logger: noopLogger, flags: { ragUpdate: false } });
    expect(r.skipped).toBe(true);
  });

  it("skips when config.rag.autoUpdate.onRun === false", async () => {
    const r = await maybeAutoUpdate({ projectDir, config: { rag: { autoUpdate: { onRun: false } } }, logger: noopLogger });
    expect(r.skipped).toBe(true);
  });

  it("skips when the directory is not a git repo", async () => {
    const r = await maybeAutoUpdate({ projectDir, config: {}, logger: noopLogger });
    expect(r.skipped).toBe(true);
  });
});

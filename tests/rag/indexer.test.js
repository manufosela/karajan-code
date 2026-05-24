// KJC-PCS-0049 Step 4 — indexer acceptance pins.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openVecStore, countChunks } from "../../src/rag/vec-store.js";
import { indexFile, indexProject } from "../../src/rag/indexer.js";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeEmbedder({ dim = 8, fail = false } = {}) {
  return { embed: vi.fn(async () => { if (fail) throw new Error("ollama down"); const v = new Float32Array(dim); v[0] = 1; return v; }), dim };
}

describe("indexer — KJC-PCS-0049 Step 4", () => {
  let root, db, dbFile;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-rag-idx-"));
    dbFile = join(root, "rag.db");
    db = openVecStore({ dim: 8, path: dbFile });
  });
  afterEach(() => {
    db?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("indexFile indexes a plan JSON and is idempotent on re-run", async () => {
    const planPath = join(root, "plan-001.json");
    writeFileSync(planPath, JSON.stringify({ hus: [{ id: "A", title: "alpha", description: "do A" }, { id: "B", title: "beta", description: "do B" }] }));
    const e = fakeEmbedder();
    const first = await indexFile(planPath, { db, embedder: e, logger: noopLogger });
    expect(first.indexed).toBe(2);
    const after = countChunks(db);
    await indexFile(planPath, { db, embedder: e, logger: noopLogger });
    expect(countChunks(db)).toBe(after); // idempotent: same total, not double
  });

  it("indexFile detects onboarding kind for ~/.karajan/onboarding/*.md", async () => {
    mkdirSync(join(root, "onboarding"), { recursive: true });
    const briefPath = join(root, "onboarding", "myproj.md");
    writeFileSync(briefPath, "# Brief\n\n## Stack\n\nNode 20.");
    await indexFile(briefPath, { db, embedder: fakeEmbedder(), logger: noopLogger });
    expect(countChunks(db, { kind: "onboarding" })).toBeGreaterThan(0);
  });

  it("indexFile continues past embedder failures and reports them", async () => {
    const planPath = join(root, "plan-002.json");
    writeFileSync(planPath, JSON.stringify({ hus: [{ id: "A", title: "a", description: "x" }] }));
    const r = await indexFile(planPath, { db, embedder: fakeEmbedder({ fail: true }), logger: noopLogger });
    expect(r.indexed).toBe(0);
    expect(r.failed).toBeGreaterThan(0);
  });

  it("indexProject indexes plans + onboarding for the project slug", async () => {
    const projectDir = join(root, "myproj"); mkdirSync(projectDir);
    const home = join(root, ".karajan");
    mkdirSync(join(home, "plans", "myproj"), { recursive: true });
    writeFileSync(join(home, "plans", "myproj", "plan-xyz.json"), JSON.stringify({ hus: [{ id: "A", title: "alpha", description: "do alpha" }] }));
    mkdirSync(join(home, "onboarding"), { recursive: true });
    writeFileSync(join(home, "onboarding", "myproj.md"), "# Brief\n\nText.");
    const totals = await indexProject(projectDir, { db, embedder: fakeEmbedder(), karajanHome: home, logger: noopLogger });
    expect(totals.files).toBe(2);
    expect(countChunks(db, { kind: "plan" })).toBeGreaterThan(0);
    expect(countChunks(db, { kind: "onboarding" })).toBeGreaterThan(0);
  });

  it("indexProject --with-sources walks JS files but skips node_modules", async () => {
    const projectDir = join(root, "p2");
    mkdirSync(join(projectDir, "node_modules", "x"), { recursive: true });
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", "main.js"), "export function alpha() { return 1; }");
    writeFileSync(join(projectDir, "node_modules", "x", "skip.js"), "export function skipMe() {}");
    const totals = await indexProject(projectDir, { db, embedder: fakeEmbedder(), karajanHome: join(root, "missing"), logger: noopLogger, withSources: true });
    expect(totals.files).toBe(1); // only src/main.js
    expect(countChunks(db, { kind: "code" })).toBeGreaterThan(0);
  });

  // KJC-BUG-0062: `.kj/worktrees/HU-*/` and `tests/_diet/` are scratch
  // sandboxes (per-HU git worktrees and the test-diet audit harness).
  // They contain duplicates of src/ that contaminate retrieval scores.
  it("indexProject --with-sources skips .kj/ worktrees and _diet sandboxes", async () => {
    const projectDir = join(root, "p3");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, ".kj", "worktrees", "HU-001", "src"), { recursive: true });
    mkdirSync(join(projectDir, "tests", "_diet"), { recursive: true });
    writeFileSync(join(projectDir, "src", "main.js"), "export function alpha() { return 1; }");
    writeFileSync(join(projectDir, ".kj", "worktrees", "HU-001", "src", "dup.js"), "export function dup() {}");
    writeFileSync(join(projectDir, "tests", "_diet", "noise.js"), "export function noise() {}");
    const totals = await indexProject(projectDir, { db, embedder: fakeEmbedder(), karajanHome: join(root, "missing-2"), logger: noopLogger, withSources: true });
    expect(totals.files).toBe(1); // only src/main.js
  });
});

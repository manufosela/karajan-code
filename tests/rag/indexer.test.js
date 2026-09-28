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

  // KJC-PCS-0052 PR-A — un repo Python (detectado por pyproject.toml) indexa
  // .py via el language adapter registry, y NO recoge node_modules (que en un
  // repo Python no debería existir, pero el matcher cumple igual). Cero
  // regresión en repos JS: el test JS-only de arriba sigue verde sin tocar.
  // KJC-TSK-0891: contar ficheros no basta; hay que ver chunks REALES. Un tipo
  // que el esquema no admite dejaba cada chunk en "embed failed".
  it("indexProject --with-sources stores real chunks for a .astro, a .php and a README.md", async () => {
    const projectDir = join(root, "any-text");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", "Page.astro"), "---\nconst t = 1;\n---\n<h1>{t}</h1>\n");
    writeFileSync(join(projectDir, "src", "User.php"), "<?php\nclass User { public $name; }\n");
    writeFileSync(join(projectDir, "README.md"), "# Demo\n\nWhat this project does.\n");
    const totals = await indexProject(projectDir, { db, embedder: fakeEmbedder(), karajanHome: join(root, "missing-any"), logger: noopLogger, withSources: true });
    expect(totals.failed).toBe(0);
    const sources = db.prepare("SELECT DISTINCT source FROM chunks WHERE kind = 'code'").all().map((r) => r.source.slice(projectDir.length + 1)).sort();
    expect(sources).toEqual(["README.md", "src/Page.astro", "src/User.php"]);
  });

  it("indexProject --with-sources indexes .py files in a Python project (manifest detected)", async () => {
    const projectDir = join(root, "py-proj");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, "__pycache__"), { recursive: true });
    writeFileSync(join(projectDir, "pyproject.toml"), "[project]\nname='demo'\n");
    writeFileSync(join(projectDir, "src", "app.py"), "def alpha():\n    return 1\n");
    writeFileSync(join(projectDir, "__pycache__", "app.cpython-311.pyc"), "x");
    const totals = await indexProject(projectDir, { db, embedder: fakeEmbedder(), karajanHome: join(root, "missing-py"), logger: noopLogger, withSources: true });
    // KJC-TSK-0891: any versioned text enters (src/app.py + pyproject.toml);
    // __pycache__ is still a path the indexer always skips.
    expect(totals.files).toBe(2);
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

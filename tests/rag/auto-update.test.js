// KJC-TSK-0455 — vec_store_meta helpers + indexProjectDelta() vs a synthetic git repo.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  openVecStore, countChunks,
  getLastIndexedCommit, setLastIndexedCommit,
} from "../../src/rag/vec-store.js";
import { indexProject, indexProjectDelta } from "../../src/rag/indexer.js";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const embedder = { embed: vi.fn(async () => { const v = new Float32Array(8); v[0] = 1; return v; }), dim: 8 };

async function gitInit(dir) {
  await execa("git", ["-C", dir, "init", "-q"]);
  await execa("git", ["-C", dir, "config", "user.email", "t@e.x"]);
  await execa("git", ["-C", dir, "config", "user.name", "t"]);
  await execa("git", ["-C", dir, "config", "commit.gpgsign", "false"]);
}
async function gitCommit(dir, msg) {
  await execa("git", ["-C", dir, "add", "-A"]);
  await execa("git", ["-C", dir, "commit", "-q", "-m", msg]);
  const { stdout } = await execa("git", ["-C", dir, "rev-parse", "HEAD"]);
  return stdout.trim();
}

describe("vec_store_meta helpers — KJC-TSK-0455", () => {
  let root, db;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kj-meta-")); db = openVecStore({ dim: 8, path: join(root, "rag.db") }); });
  afterEach(() => { db?.close(); rmSync(root, { recursive: true, force: true }); });

  it("round-trip, upsert and per-slug isolation", () => {
    expect(getLastIndexedCommit(db, "proja")).toBeNull();
    setLastIndexedCommit(db, "proja", "aaa");
    setLastIndexedCommit(db, "projb", "bbb");
    setLastIndexedCommit(db, "proja", "ccc"); // upsert
    expect(getLastIndexedCommit(db, "proja")).toBe("ccc");
    expect(getLastIndexedCommit(db, "projb")).toBe("bbb");
  });

  it("is a no-op with missing args", () => {
    setLastIndexedCommit(db, null, "abc");
    setLastIndexedCommit(db, "p", null);
    expect(getLastIndexedCommit(db, null)).toBeNull();
    expect(getLastIndexedCommit(db, "p")).toBeNull();
  });
});

describe("indexProjectDelta — KJC-TSK-0455", () => {
  let root, projectDir, db;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-delta-"));
    projectDir = join(root, "myproj");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    db = openVecStore({ dim: 8, path: join(root, "rag.db") });
  });
  afterEach(() => { db?.close(); rmSync(root, { recursive: true, force: true }); });

  it("returns head + zero changes when since === HEAD", async () => {
    await gitInit(projectDir);
    writeFileSync(join(projectDir, "src", "a.js"), "export const a = 1;");
    const head = await gitCommit(projectDir, "init");
    const t = await indexProjectDelta(projectDir, { db, embedder, since: head, logger: noopLogger });
    expect(t.head).toBe(head);
    expect(t.indexed).toBe(0);
    expect(t.deleted).toBe(0);
  });

  it("processes A/M, D and R (rename) statuses; skips non-code and excluded segments", async () => {
    await gitInit(projectDir);
    writeFileSync(join(projectDir, "src", "old.js"), "export const x = 1;");
    writeFileSync(join(projectDir, "src", "doomed.js"), "export const y = 1;");
    const base = await gitCommit(projectDir, "init");
    // Pre-seed so D and R can actually drop chunks.
    await indexProject(projectDir, { db, embedder, karajanHome: join(root, "missing"), logger: noopLogger, withSources: true });
    const seeded = countChunks(db);
    expect(seeded).toBeGreaterThan(0);
    // A new, M existing, D one, R another. Plus noise that must be skipped.
    writeFileSync(join(projectDir, "src", "added.js"), "export const z = 1;");
    rmSync(join(projectDir, "src", "doomed.js"));
    await execa("git", ["-C", projectDir, "mv", "src/old.js", "src/new.js"]);
    writeFileSync(join(projectDir, "README.md"), "# noise");
    mkdirSync(join(projectDir, "dist"), { recursive: true });
    writeFileSync(join(projectDir, "dist", "bundle.js"), "// noise");
    await gitCommit(projectDir, "delta");
    const t = await indexProjectDelta(projectDir, { db, embedder, since: base, logger: noopLogger });
    expect(t.indexed).toBeGreaterThan(0); // added.js + new.js
    expect(t.deleted).toBeGreaterThan(0); // doomed.js + old.js
    // README.md (non-code) and dist/bundle.js (excluded segment) must NOT be counted.
    expect(t.files).toBe(2); // added.js + new.js
  });

  it("throws when since is unknown so the CLI can fall back", async () => {
    await gitInit(projectDir);
    writeFileSync(join(projectDir, "src", "a.js"), "export const a = 1;");
    await gitCommit(projectDir, "init");
    await expect(
      indexProjectDelta(projectDir, { db, embedder, since: "0".repeat(40), logger: noopLogger })
    ).rejects.toThrow();
  });
});

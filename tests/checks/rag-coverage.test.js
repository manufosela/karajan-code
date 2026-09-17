// KJC-TSK-0850 (ADR 0010, RAG-D) — the check item: red when an index
// exists and misses or lags a source, red when its freshness cannot be
// established, informative only when there is no index yet.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openVecStore, setLastIndexedCommit } from "../../src/rag/vec-store.js";
import { createRagCoverageCheck } from "../../src/checks/rag-coverage.js";
import { makeCoverageRepo } from "../rag/coverage-fixture.js";

let f;
beforeEach(() => { f = makeCoverageRepo(); });
afterEach(() => f.cleanup());

// The check owns (and closes) the connection it opens: give it its own one to the same file.
const detect = () => createRagCoverageCheck({ openStore: () => openVecStore({ dim: 8, path: f.dbFile }) }).detect({ config: {}, projectDir: f.repo });

describe("rag-coverage check", () => {
  it("is red when the index exists but misses a source, and points at the full walk", async () => {
    f.index("src/a.js", 0);
    setLastIndexedCommit(f.db, f.slug, f.head());
    const r = await detect();
    expect(r).toMatchObject({ ok: false, severity: "fail" });
    expect(r.detail).toMatch(/2 source\(s\) outside the RAG index/);
    expect(r.detail).toMatch(/scripts\/b\.js/);
    expect(r.detail).toMatch(/--with-sources/); // a missing source needs the full walk, not --since
  });

  it("points at --since when everything is indexed but some of it is stale", async () => {
    for (const [i, rel] of ["src/a.js", "scripts/b.js", "packages/x/src/c.js"].entries()) f.index(rel, i);
    setLastIndexedCommit(f.db, f.slug, f.head());
    fs.writeFileSync(path.join(f.repo, "src/a.js"), "export const x = 2;\n");
    f.git("commit", "-q", "-am", "change a");
    const r = await detect();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/0 source\(s\) outside the RAG index, 1 stale/);
    expect(r.detail).toMatch(/--since/);
  });

  it("is red when the index has chunks but no commit stamp (freshness unknown)", async () => {
    f.index("src/a.js", 0);
    const r = await detect();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/no commit stamp/);
  });

  it("is red when the stamped commit cannot be reached from HEAD", async () => {
    f.index("src/a.js", 0);
    setLastIndexedCommit(f.db, f.slug, "0123456789abcdef0123456789abcdef01234567");
    const r = await detect();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/not reachable from HEAD/);
  });

  it("only informs when there is no index for the project yet", async () => {
    const r = await detect();
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/no RAG index/);
  });
});

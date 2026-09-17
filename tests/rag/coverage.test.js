// KJC-TSK-0850 (ADR 0010, RAG-D) — index coverage as a defect. A gate built
// on the RAG protects nothing it cannot see: every source the indexer's
// matchers would take must be in the store for this project, and none may
// be older than the commit the index was stamped with.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setLastIndexedCommit } from "../../src/rag/vec-store.js";
import { ragIndexCoverage } from "../../src/rag/coverage.js";
import { makeCoverageRepo } from "./coverage-fixture.js";

let f;
beforeEach(() => { f = makeCoverageRepo(); });
afterEach(() => f.cleanup());

describe("ragIndexCoverage", () => {
  it("reports every matcher source the store lacks, including scripts/ and packages/*/src", async () => {
    f.index("src/a.js", 0);
    f.index("packages/x/src/c.js", 1);
    setLastIndexedCommit(f.db, f.slug, f.head());

    const c = await ragIndexCoverage(f.repo, { db: f.db });
    // bin/tool (no extension), node_modules/ and README.md are not sources for the matchers.
    expect(c).toMatchObject({ project: "myproj", total: 3, indexed: 2, absent: false, missing: ["scripts/b.js"], stale: [] });
  });

  it("flags sources changed since the stamped commit as stale", async () => {
    for (const [i, rel] of ["src/a.js", "scripts/b.js", "packages/x/src/c.js"].entries()) f.index(rel, i);
    setLastIndexedCommit(f.db, f.slug, f.head());
    fs.writeFileSync(path.join(f.repo, "src/a.js"), "export const x = 2;\n");
    f.git("commit", "-q", "-am", "change a");

    const c = await ragIndexCoverage(f.repo, { db: f.db });
    expect(c.missing).toEqual([]);
    expect(c.stale).toEqual(["src/a.js"]);
  });

  it("throws when the stamped commit cannot be reached from HEAD (freshness unknown)", async () => {
    f.index("src/a.js", 0);
    setLastIndexedCommit(f.db, f.slug, "0123456789abcdef0123456789abcdef01234567");
    await expect(ragIndexCoverage(f.repo, { db: f.db })).rejects.toThrow(/not reachable from HEAD/);
  });

  it("says the index is absent when the project has no code chunks at all", async () => {
    const c = await ragIndexCoverage(f.repo, { db: f.db });
    expect(c).toMatchObject({ absent: true, total: 3, indexed: 0, lastIndexedCommit: null });
  });
});

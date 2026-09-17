/**
 * KJC-TSK-0850 (ADR 0010, RAG-D) — `kj check` / `kj doctor` item: the RAG
 * index covers every source of the project and is not older than HEAD.
 * Red only when an index EXISTS and is incomplete or stale: a machine with
 * no index yet (CI, a fresh clone) gets the command, not a failure.
 */
import { openVecStore } from "../rag/vec-store.js";
import { ragIndexCoverage } from "../rag/coverage.js";
import { STRATEGY } from "./types.js";

export function createRagCoverageCheck({ openStore = (dim) => openVecStore({ dim }) } = {}) {
  return {
    name: "rag-coverage",
    label: "RAG index coverage (ADR 0010)",
    strategy: STRATEGY.NONE,
    async detect({ config = {}, projectDir = process.cwd() } = {}) {
      const db = openStore(config?.rag?.embedder?.dim || 768);
      try {
        let c;
        try {
          c = await ragIndexCoverage(projectDir, { db });
        } catch (err) {
          // Corrupt store, unreachable stamp, git failure: a failing check,
          // never a silent pass. The only tolerated non-red state is "no index".
          return { ok: false, severity: "fail", detail: `rag coverage could not be evaluated: ${err.message}` };
        }
        if (c.absent) {
          return { ok: true, severity: "info", detail: `no RAG index for ${c.project} yet (${c.total} sources) — kj rag index --with-sources` };
        }
        if (!c.lastIndexedCommit) {
          // Chunks without a commit stamp: nothing says how old they are, so
          // freshness cannot be established — that is a defect, not a pass.
          return { ok: false, severity: "fail", detail: `the RAG index of ${c.project} carries no commit stamp, freshness unknown (${c.indexed}/${c.total} sources) — kj rag index --with-sources` };
        }
        const gaps = [...c.missing, ...c.stale];
        if (gaps.length > 0) {
          // --since only re-embeds files CHANGED since the stamp: a source the
          // store never saw needs the full walk.
          const stamp = c.lastIndexedCommit.slice(0, 9);
          const fix = c.missing.length === 0 ? `kj rag index --since ${stamp}` : "kj rag index --with-sources";
          const sample = gaps.slice(0, 3).join(", ") + (gaps.length > 3 ? ", …" : "");
          return { ok: false, severity: "fail", detail: `${c.missing.length} source(s) outside the RAG index, ${c.stale.length} stale (${sample}) — ${fix}` };
        }
        return { ok: true, severity: "info", detail: `${c.indexed}/${c.total} sources indexed at ${c.lastIndexedCommit.slice(0, 9)}` };
      } finally {
        db.close();
      }
    },
  };
}

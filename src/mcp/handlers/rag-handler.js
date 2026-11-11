// KJC-PCS-0049 Step 7 — MCP handlers calling src/rag/* directly. Imports
// from src/commands/* are forbidden by the layer-boundaries test
// (MCP and CLI are peer layers); we hit the pure rag/* modules instead.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countChunks, projectSlug } from "../../rag/vec-store.js";
import { openProjectStore } from "../../rag/project-store.js";
import { countProjectChunks, emptyIndexRemedy } from "../../rag/migrate.js";
import { makeGovernedEmbedder } from "../../rag/governed-embedder.js";
import { indexProject } from "../../rag/indexer.js";
import { ragExclude } from "../../rag/indexable.js";
import { query } from "../../rag/retriever.js";
import { pathNamedHits, withPathNamedHits } from "../../rag/path-hits.js";
import { noteRagAnswer, noteRagIndex } from "../../rag/answer-note.js";
import { claimLease, holderLabel, indexLeasePath, releaseLease } from "../../rag/pid-lease.js";
import { getKarajanHome } from "../../utils/paths.js";
import { resolveProjectDir, buildConfig, responseText, failPayload } from "../shared-helpers.js";

const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, setContext: () => {},
};

const packageDir = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
// HU-3689 (#3673): a module that cannot load is named with its repair, not left as a bare "Cannot find module".
function failureText(tool, err) {
  const missing = err?.code === "MODULE_NOT_FOUND" || /^Cannot find (module|package)/.test(err?.message ?? "");
  if (!missing) return `${tool} failed: ${err.message}`;
  return `${tool} failed: the RAG store could not load: ${err.message}. Reinstall kj (npm install -g karajan-code) or run npm rebuild in ${packageDir}`;
}
export async function handleRagQuery(args, server) {
  const text = args?.text;
  if (typeof text !== "string" || text.length === 0) {
    return failPayload("kj_rag_query: 'text' is required and must be a non-empty string");
  }
  try {
    const projectDir = await resolveProjectDir(server, args?.projectDir);
    const config = await buildConfig({ ...args, projectDir }, "rag-query");
    const topK = Number(args?.topK) || 5;
    const scope = args?.scope || "all";
    // KJC-BUG-0177 (#1713): the store is shared by every indexed project,
    // and the MCP tool searched it unfiltered while the CLI (KJC-TSK-0438)
    // scoped to the project's slug. Same rule here: default = slug of
    // projectDir, `project: "all"` disables the filter, `project: <slug>`
    // overrides it.
    const project = args?.project === "all" ? null : (args?.project || projectSlug(projectDir) || null);
    const dim = config?.rag?.embedder?.dim || 768;
    // KJC-TSK-0883 (ADR 0011): el indice del proyecto, como la CLI (0882).
    const db = openProjectStore({ projectDir, dim });
    try {
      if (countChunks(db) === 0 || (project && countProjectChunks(db, project) === 0)) {
        const remedy = emptyIndexRemedy({ slug: project, legacyPath: join(getKarajanHome(), "rag.db"), dim });
        return responseText({ hits: [], empty: true, topK, scope, project, remedy });
      }
      const ranked = await query(db, makeGovernedEmbedder(config), text, { topK, scope, project });
      // KJC-BUG-0348: a file the question names comes first, as in the CLI.
      const hits = withPathNamedHits(pathNamedHits(db, text, { project, projectDir }), ranked, topK);
      // KJC-TSK-1438 (ADR 0048): the answer note, as the CLI leaves it, so kj stage sees the MCP's answers too.
      noteRagAnswer({ projectDir, text, hits });
      return responseText({ hits, empty: false, topK, scope, project });
    } finally { db.close(); }
  } catch (err) {
    return failPayload(failureText("kj_rag_query", err));
  }
}

export async function handleRagIndex(args, server) {
  try {
    const projectDir = await resolveProjectDir(server, args?.projectDir);
    const config = await buildConfig({ ...args, projectDir }, "rag-index");
    const db = openProjectStore({ projectDir, dim: config?.rag?.embedder?.dim || 768 });
    // HU-2907: the long-lived host holds the machine lease for the walk and releases it in the finally.
    const lease = indexLeasePath();
    let claim;
    try {
      claim = claimLease(lease, { projectDir, slug: projectSlug(projectDir) });
      // HU-3279: yield to another live indexer unless forced; its lease is never touched.
      if (!claim.claimed && args?.force !== true) {
        return failPayload(`kj_rag_index: another index is running (${holderLabel(claim)}); not indexing. Pass force: true to index anyway`);
      }
      noteRagIndex({ projectDir, phase: "start" }); // KJC-TSK-1521: kj stage shows kaRAGan at it
      const totals = await indexProject(projectDir, {
        db, embedder: makeGovernedEmbedder(config),
        karajanHome: getKarajanHome(), logger: silentLogger,
        withSources: Boolean(args?.withSources),
        exclude: ragExclude(config), // KJC-TSK-0891
      }).finally(() => noteRagIndex({ projectDir, phase: "end" }));
      return responseText(totals);
    } finally {
      if (claim?.claimed) releaseLease(lease);
      db.close();
    }
  } catch (err) {
    return failPayload(failureText("kj_rag_index", err));
  }
}

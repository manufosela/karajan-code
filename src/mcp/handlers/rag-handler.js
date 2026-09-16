// KJC-PCS-0049 Step 7 — MCP handlers calling src/rag/* directly. Imports
// from src/commands/* are forbidden by the layer-boundaries test
// (MCP and CLI are peer layers); we hit the pure rag/* modules instead.
import { countChunks, openVecStore, projectSlug } from "../../rag/vec-store.js";
import { makeGovernedEmbedder } from "../../rag/governed-embedder.js";
import { indexProject } from "../../rag/indexer.js";
import { query } from "../../rag/retriever.js";
import { getKarajanHome } from "../../utils/paths.js";
import { resolveProjectDir, buildConfig, responseText, failPayload } from "../shared-helpers.js";

const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, setContext: () => {},
};

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
    const db = openVecStore({ dim: config?.rag?.embedder?.dim || 768 });
    try {
      if (countChunks(db) === 0) return responseText({ hits: [], empty: true, topK, scope, project });
      const hits = await query(db, makeGovernedEmbedder(config), text, { topK, scope, project });
      return responseText({ hits, empty: false, topK, scope, project });
    } finally { db.close(); }
  } catch (err) {
    return failPayload(`kj_rag_query failed: ${err.message}`);
  }
}

export async function handleRagIndex(args, server) {
  try {
    const projectDir = await resolveProjectDir(server, args?.projectDir);
    const config = await buildConfig({ ...args, projectDir }, "rag-index");
    const db = openVecStore({ dim: config?.rag?.embedder?.dim || 768 });
    try {
      const totals = await indexProject(projectDir, {
        db, embedder: makeGovernedEmbedder(config),
        karajanHome: getKarajanHome(), logger: silentLogger,
        withSources: Boolean(args?.withSources),
      });
      return responseText(totals);
    } finally { db.close(); }
  } catch (err) {
    return failPayload(`kj_rag_index failed: ${err.message}`);
  }
}

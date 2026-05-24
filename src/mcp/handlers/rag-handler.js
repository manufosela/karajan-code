// KJC-PCS-0049 Step 7 — MCP handlers wrapping the RAG CLI commands so
// agents can call kj_rag_query / kj_rag_index as plain MCP tools.
import { ragQueryCommand, ragIndexCommand } from "../../commands/rag.js";
import { countChunks, openVecStore } from "../../rag/vec-store.js";
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
    const hits = await ragQueryCommand({
      text, config, logger: silentLogger, flags: { topK, scope, json: true },
    });
    const db = openVecStore({ dim: config?.rag?.embedder?.dim || 768 });
    const empty = countChunks(db) === 0;
    db.close();
    return responseText({ hits, empty, topK, scope });
  } catch (err) {
    return failPayload(`kj_rag_query failed: ${err.message}`);
  }
}

export async function handleRagIndex(args, server) {
  try {
    const projectDir = await resolveProjectDir(server, args?.projectDir);
    const config = await buildConfig({ ...args, projectDir }, "rag-index");
    const totals = await ragIndexCommand({
      config, logger: silentLogger,
      flags: { withSources: Boolean(args?.withSources), json: true },
    });
    return responseText(totals);
  } catch (err) {
    return failPayload(`kj_rag_index failed: ${err.message}`);
  }
}

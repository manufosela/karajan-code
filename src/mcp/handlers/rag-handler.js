// KJC-PCS-0049 Step 7 — MCP handlers calling src/rag/* directly. Imports
// from src/commands/* are forbidden by the layer-boundaries test
// (MCP and CLI are peer layers); we hit the pure rag/* modules instead.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countChunks, projectSlug } from "../../rag/vec-store.js";
import { openProjectStore } from "../../rag/project-store.js";
import { countProjectChunks, emptyIndexRemedy } from "../../rag/migrate.js";
import { makeGovernedEmbedder } from "../../rag/governed-embedder.js";
import { query } from "../../rag/retriever.js";
import { pathNamedHits, withPathNamedHits } from "../../rag/path-hits.js";
import { noteRagAnswer, noteRagQuery } from "../../rag/answer-note.js";
import { holderLabel } from "../../rag/pid-lease.js";
import { readBootstrap, startBootstrap } from "../../rag/bootstrap-index.js";
import { getKarajanHome } from "../../utils/paths.js";
import { resolveProjectDir, buildConfig, responseText, failPayload } from "../shared-helpers.js";

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
      noteRagQuery({ projectDir }); // KJC-TSK-1630: kj stage shows kaRAGan at it until the answer
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

// KJC-BUG-0610: a large repo ran past the host's tool timeout with no progress. The index runs as
// `kj rag index` in the background (the bootstrap's marker and machine lease, which it notes and
// releases itself) and the tool answers at once; called again, it answers with the progress.
const NEXT = "call kj_rag_index again to see its progress; kj_rag_query answers from the current index meanwhile";

export async function handleRagIndex(args, server, { start = startBootstrap, read = readBootstrap } = {}) {
  try {
    const projectDir = await resolveProjectDir(server, args?.projectDir);
    const current = read(projectDir);
    if (current?.running) return responseText({ running: true, pid: current.pid, progress: current.progress ?? null, next: NEXT });
    const force = args?.force === true;
    const indexArgs = [...(args?.withSources ? ["--with-sources"] : []), ...(force ? ["--force"] : [])];
    const res = start(projectDir, { indexArgs, explicit: true, force });
    // HU-3279: yield to another live indexer unless forced; its lease is never touched.
    if (res.busy) return failPayload(`kj_rag_index: another index is running (${holderLabel({ holder: res.busy.pid ? res.busy : null })}); not indexing. Pass force: true to index anyway`);
    return responseText({ started: res.started, pid: res.pid ?? null, last: current?.totals ?? null, next: NEXT });
  } catch (err) {
    return failPayload(failureText("kj_rag_index", err));
  }
}

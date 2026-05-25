// KJC-PCS-0049 Step 6 — `kj rag` command group. Two subcommands:
//   kj rag index [--project <slug>] [--with-sources]
//   kj rag query <text>   [--scope plans|code|onboarding|all] [--top-k N] [--json]
// Closes the v2.22.0 RAG MVP end-to-end from the terminal.
import { openVecStore, countChunks, projectSlug } from "../rag/vec-store.js";
import { makeEmbedder } from "../rag/embedders/factory.js";
import { indexProject } from "../rag/indexer.js";
import { query } from "../rag/retriever.js";
import { getKarajanHome } from "../utils/paths.js";

function openDb(config) {
  return openVecStore({ dim: config?.rag?.embedder?.dim || 768 });
}

export async function ragIndexCommand({ config, logger, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const db = openDb(config);
  try {
    const totals = await indexProject(projectDir, {
      db, embedder: makeEmbedder(config),
      karajanHome: getKarajanHome(), logger,
      withSources: Boolean(flags.withSources),
    });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(totals)}\n`);
    } else {
      logger.info(`[rag] indexed ${totals.indexed} chunk(s) across ${totals.files} file(s) (${totals.failed} failed)`);
    }
    return totals;
  } finally {
    db.close();
  }
}

export async function ragQueryCommand({ text, config, logger, flags = {} }) {
  if (!text) throw new Error("kj rag query: text argument required");
  const db = openDb(config);
  try {
    const topK = Math.max(1, Number(flags.topK) || 5);
    const scope = flags.scope || "all";
    // KJC-TSK-0438 — project isolation. Auto-detect slug from projectDir
    // (basename normalised); `--project all` disables the filter, `--project
    // <slug>` overrides. Pre-v2.27 chunks with NULL slug are only visible
    // when no filter is in effect.
    const detected = projectSlug(config?.projectDir || process.cwd());
    const project = flags.project === "all" ? null : (flags.project || detected || null);
    // KJC-BUG-0061 follow-up: align the CLI `--json` shape with the MCP
    // handler. The MCP tool responds `{ hits: [], empty: true, topK, scope }`
    // so agents (and the `/kj-rag-query` skill from Camino B) have a
    // deterministic recovery signal. The CLI was emitting just `[]`, which
    // is indistinguishable from "query returned zero hits over a populated
    // store" and forced consumers to parse stderr.
    if (countChunks(db) === 0) {
      logger.warn("[rag] No chunks indexed yet. Run 'kj rag index' first.");
      if (flags.json) process.stdout.write(`${JSON.stringify({ hits: [], empty: true, topK, scope })}\n`);
      return [];
    }
    const mode = flags.mode || "hybrid";
    const alpha = Math.max(0, Math.min(1, Number(flags.alpha) || 0.6));
    const where = flags.where || null;
    const rerankOpts = flags.rerank ? { model: flags.rerankModel } : null;
    const hits = await query(db, makeEmbedder(config), text, { topK, scope, project, mode, alpha, where, rerankOpts });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(hits)}\n`);
    } else {
      for (const h of hits) {
        const label = h.metadata?.hu_id || h.metadata?.symbol || h.metadata?.headingPath?.join(" > ") || "block";
        logger.info(`[${h.kind} · ${label} · score=${h.score.toFixed(4)}] ${h.source}`);
        logger.info(h.text.length > 240 ? `${h.text.slice(0, 240)}…` : h.text);
        logger.info("");
      }
    }
    return hits;
  } finally {
    db.close();
  }
}

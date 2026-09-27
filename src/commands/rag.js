import { join } from "node:path";
// KJC-PCS-0049 Step 6 — `kj rag` command group. Two subcommands:
//   kj rag index [--project <slug>] [--with-sources]
//   kj rag query <text>   [--scope plans|code|onboarding|all] [--top-k N] [--json]
// Closes the v2.22.0 RAG MVP end-to-end from the terminal.
import { countChunks, projectSlug, getLastIndexedCommit, setLastIndexedCommit } from "../rag/vec-store.js";
import { makeGovernedEmbedder } from "../rag/governed-embedder.js";
import { indexProject, indexProjectDelta } from "../rag/indexer.js";
import { fileIndexState } from "../rag/coverage.js";
import { query } from "../rag/retriever.js";
import { installPostMergeHook, maybeAutoUpdate } from "../rag/auto-update.js";
import { indexLibrary, LIBRARY_PROJECT } from "../rag/library.js";
import { loadGoldenQueries, runEval } from "../rag/eval.js";
import { getKarajanHome } from "../utils/paths.js";
import { countProjectChunks, emptyIndexRemedy, migrateProjectIndex } from "../rag/migrate.js";
import { openLibraryStore, openProjectStore, projectDbPath } from "../rag/project-store.js";

// KJC-TSK-0882 (ADR 0011): el indice es del proyecto, no de la maquina.
function openDb(config) {
  return openProjectStore({ projectDir: config?.projectDir || process.cwd(), dim: config?.rag?.embedder?.dim || 768 });
}

export async function ragIndexCommand({ config, logger, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const db = openDb(config);
  try {
    const slug = projectSlug(projectDir);
    const embedder = makeGovernedEmbedder(config);
    const sinceFlag = flags.since;
    // KJC-TSK-0455 — `--since auto` resolves to the last commit we indexed;
    // an explicit ref is honoured as-is. Without a baseline (first-time
    // index) we fall back to a full reindex with a friendly warning so the
    // hook in PR2 stays a no-op-friendly entrypoint.
    let since = null;
    if (sinceFlag) {
      since = sinceFlag === "auto" ? getLastIndexedCommit(db, slug) : sinceFlag;
      if (!since) logger.warn?.("[rag] --since auto: no previous index recorded; running full index");
    }
    let totals;
    if (since) {
      try {
        totals = await indexProjectDelta(projectDir, { db, embedder, since, logger });
      } catch (err) {
        logger.warn?.(`[rag] delta index failed (${err.message}); falling back to full index`);
        totals = null;
      }
    }
    if (!totals) {
      totals = await indexProject(projectDir, {
        db, embedder,
        karajanHome: getKarajanHome(), logger,
        withSources: Boolean(flags.withSources),
      });
    }
    if (totals.head) setLastIndexedCommit(db, slug, totals.head);
    // KJC-TSK-0697 — the library corpus refreshes on every index run.
    // Best-effort and cheap: a handful of cards, content-hash dedup.
    // KJC-TSK-0883: el canon de la maquina a su base; las fichas del proyecto, a la suya.
    try {
      const lib = openLibraryStore({ dim: config?.rag?.embedder?.dim || 768 });
      try { await indexLibrary({ db: lib, embedder, logger, scope: "machine" }); } finally { lib.close(); }
      await indexLibrary({ db, embedder, logger, projectDir, scope: "project", project: slug });
    } catch (err) {
      logger.warn?.(`[rag] library index failed: ${err.message}`);
    }
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(totals)}\n`);
    } else {
      logger.info(`[rag] indexed ${totals.indexed} chunk(s) across ${totals.files} file(s) (${totals.failed} failed${totals.deleted ? `, ${totals.deleted} chunks deleted` : ""})`);
    }
    return totals;
  } finally {
    db.close();
  }
}

// KJC-TSK-0455 — `kj rag install-hooks` wires the post-merge hook so the
// local index keeps up after `git pull` / merges. Opt-in to keep us from
// silently writing under `.git/hooks/`; pre-run drift check covers users
// who never run it.
export async function ragInstallHooksCommand({ config, logger, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const res = await installPostMergeHook({ projectDir, logger });
  if (flags.json) process.stdout.write(`${JSON.stringify(res)}\n`);
  else if (res.installed) logger.info(`[rag] installed post-merge hook at ${res.target}${res.hooksPath ? ` (core.hooksPath=${res.hooksPath})` : ""}`);
  else if (res.covered) logger.info(`[rag] ${res.target} already reindexes the RAG (kj-managed); nothing to do`);
  return res;
}

export async function ragQueryCommand({ text, config, logger, flags = {} }) {
  if (!text) throw new Error("kj rag query: text argument required");
  // ENV-E1 (KJC-TSK-0640): never serve stale code — delta-update on drift
  // before searching. Same escape hatches as the pre-run check
  // (--no-rag-update / config.rag.autoUpdate); failures degrade to a warn
  // inside maybeAutoUpdate and the query proceeds with the current index.
  await maybeAutoUpdate({ projectDir: config?.projectDir || process.cwd(), config, logger, flags });
  // KJC-TSK-0883: --library abre la base del canon, no la del proyecto.
  const db = flags.library ? openLibraryStore({ dim: config?.rag?.embedder?.dim || 768 }) : openDb(config);
  try {
    const topK = Math.max(1, Number(flags.topK) || 5);
    const scope = flags.scope || "all";
    // KJC-TSK-0438 — project isolation. Auto-detect slug from projectDir
    // (basename normalised); `--project all` disables the filter, `--project
    // <slug>` overrides. Pre-v2.27 chunks with NULL slug are only visible
    // when no filter is in effect.
    const detected = projectSlug(config?.projectDir || process.cwd());
    // KJC-TSK-0697 — `--library` targets the distilled-canon collection:
    // its own project namespace plus the kind filter.
    const library = Boolean(flags.library);
    let project = flags.project === "all" ? null : (flags.project || detected || null);
    if (library) project = LIBRARY_PROJECT;
    // KJC-BUG-0061 follow-up: align the CLI `--json` shape with the MCP
    // handler. The MCP tool responds `{ hits: [], empty: true, topK, scope }`
    // so agents (and the `/kj-rag-query` skill from Camino B) have a
    // deterministic recovery signal. The CLI was emitting just `[]`, which
    // is indistinguishable from "query returned zero hits over a populated
    // store" and forced consumers to parse stderr.
    // KJC-TSK-0882: cuenta lo de ESTE proyecto; chunks ajenos no son respuesta.
    if (countChunks(db) === 0 || (project && countProjectChunks(db, project) === 0)) {
      // La library se rellena en cada `kj rag index`; migrar la llevaria al proyecto.
      const remedy = library ? "kj rag index" : emptyIndexRemedy({ slug: project, legacyPath: join(getKarajanHome(), "rag.db"), dim: config?.rag?.embedder?.dim || 768 });
      logger.warn(`[rag] ${library ? "the library index" : "this project's index"} holds no chunks of ${project || "any project"}: this is not an answer, run ${remedy}`);
      if (flags.json) process.stdout.write(`${JSON.stringify({ hits: [], empty: true, topK, scope, remedy })}\n`);
      return [];
    }
    const mode = flags.mode || "hybrid";
    const alpha = Math.max(0, Math.min(1, Number(flags.alpha) || 0.6));
    // Safe by grammar: parseWhere (core where-parser.js) accepts ONLY
    // AND-joined key=value pairs — an OR or parens never parses, so the
    // composed clause cannot leak past the kind filter; it fails loudly.
    let where = flags.where || null;
    if (library) where = flags.where ? `kind=library AND ${flags.where}` : "kind=library";
    const rerankOpts = flags.rerank ? { model: flags.rerankModel } : null;
    const hits = await query(db, makeGovernedEmbedder(config), text, { topK, scope, project, mode, alpha, where, rerankOpts });
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

// KJC-TSK-0483 — `kj rag eval`. Runs the retriever against a golden query
// set and reports recall@5, recall@10 and MRR per query and aggregated.
// Exit code != 0 when `--min-recall` is set and the aggregated recall@5
// falls below the threshold — lets CI fail noisily on retrieval regressions.
const DEFAULT_GOLDEN = "tests/rag/golden-queries.json";
export async function ragEvalCommand({ config, logger, flags = {} }) {
  const db = openDb(config);
  try {
    const goldenPath = flags.golden || DEFAULT_GOLDEN;
    const queries = loadGoldenQueries(goldenPath);
    const topK = Math.max(1, Number(flags.topK) || 10);
    const detected = projectSlug(config?.projectDir || process.cwd());
    const project = flags.project === "all" ? null : (flags.project || detected || null);
    const embedder = makeGovernedEmbedder(config);
    const runQuery = async (text, k) => query(db, embedder, text, { topK: k, scope: "all", project });
    const report = await runEval(queries, runQuery, { topK, ks: [5, 10] });
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      logger.info(`[rag-eval] ${report.aggregate.n} queries · recall@5=${report.aggregate.recall["@5"].toFixed(3)} · recall@10=${report.aggregate.recall["@10"].toFixed(3)} · MRR=${report.aggregate.mrr.toFixed(3)}`);
      for (const r of report.results) {
        const rank = r.firstRank == null ? "—" : `#${r.firstRank}`;
        logger.info(`  [${rank}] ${r.query}`);
      }
    }
    const minRecall = Number(flags.minRecall);
    if (Number.isFinite(minRecall) && report.aggregate.recall["@5"] < minRecall) {
      logger.error?.(`[rag-eval] recall@5=${report.aggregate.recall["@5"].toFixed(3)} below --min-recall=${minRecall}`);
      process.exitCode = 1;
    }
    return report;
  } finally {
    db.close();
  }
}

/**
 * KJC-BUG-0216 (issue #1807) — el hecho comprobable que el gate rag-first
 * necesita antes de exigir una consulta: PUEDE el RAG responder sobre este
 * fichero. Exit 0 = si; exit 1 = no, y la razon (sin adapter, segmento
 * excluido, indice vacio o por detras) va en la salida.
 */
export async function ragCoversCommand({ file, config, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const db = openDb(config);
  try {
    const state = fileIndexState(projectDir, file, { db });
    if (flags.json) process.stdout.write(`${JSON.stringify(state)}\n`);
    else process.stdout.write(`${state.state}: ${state.reason}\n`);
    if (!state.canAnswer) process.exitCode = 1;
    return state;
  } finally {
    db.close();
  }
}

/**
 * KJC-TSK-0888 (RAG-P1a, ADR 0011) — `kj rag migrate`: copia los chunks de este
 * proyecto desde la base global a su propio indice, con sus embeddings, sin
 * volver a embeber. La base global no se toca.
 */
export async function ragMigrateCommand({ config, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const res = migrateProjectIndex({
    slug: projectSlug(projectDir),
    legacyPath: join(getKarajanHome(), "rag.db"),
    targetPath: projectDbPath(projectDir),
    dim: config?.rag?.embedder?.dim || 768,
  });
  if (flags.json) process.stdout.write(`${JSON.stringify(res)}\n`);
  else process.stdout.write(`rag migrate: ${res.state} — ${res.reason}\n`);
  return res;
}

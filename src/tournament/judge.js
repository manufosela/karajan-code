/**
 * tournament/judge — TOR-C (KJC-TSK-0725, epic KJC-PCS-0073).
 *
 * The scoreboard (TOR-B) ELIMINATES; the judge CHOOSES among survivors —
 * a cross-AI reviewer ranking the finalists with the deterministic table
 * in sight, so the LLM judges what metrics cannot see (design, readability,
 * over-engineering) without overruling what they can. Two hard rules:
 * a participant coder never judges its own tournament (nor does the host),
 * and a WINNER disagreement with the scoreboard — or a declared tie —
 * escalates to solomon carrying BOTH positions. Only first place crowns:
 * lower-order differences are informative and never escalate (the card's
 * "discrepancia fuerte" — over-escalating would make solomon the judge). Diffs travel WHOLE or the limit is
 * DECLARED in the prompt (the [TRUNCATED]-blamed-on-the-file lesson,
 * BUG-0134): the judge must never mistake our clipping for the coder's code.
 */
import fs from "node:fs";
import path from "node:path";
import { createAgent } from "../agents/index.js";
import { resolveRole } from "../config/role-resolver.js";
import { detectHostAgent } from "../utils/agent-detect.js";
import { candidateStatus } from "../review/reviewer-fallback.js";

const MAX_DIFF_CHARS = 60_000;

/** The configured reviewer unless it competed or hosts; else the first clean candidate. */
export function pickJudge({ configured, participants = [], host = null, statuses = [] }) {
  const dirty = new Set([...participants, host].filter(Boolean));
  if (configured && !dirty.has(configured)) return configured;
  const clean = statuses.find((s) => s.installed && s.authenticated && !s.adapterPending && !dirty.has(s.name));
  return clean ? clean.name : null;
}

async function defaultJudge({ config, participants }) {
  const configured = resolveRole(config, "reviewer").provider;
  const statuses = await candidateStatus();
  return pickJudge({ configured, participants, host: detectHostAgent(), statuses });
}

async function defaultAgent({ judge, prompt, config, logger }) {
  return createAgent(judge, config, logger).reviewTask({ prompt, role: "reviewer" });
}

function finalistBlock(board, torDir, coder) {
  const row = board.rows.find((r) => r.coder === coder);
  let diff = fs.readFileSync(path.join(torDir, coder, "diff.patch"), "utf8");
  let clipped = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    clipped = true;
  }
  return [
    `### Finalista: ${coder}`,
    `Scoreboard: ${JSON.stringify(row)}`,
    clipped
      ? `NOTA DEL SISTEMA: el diff se muestra RECORTADO a ${MAX_DIFF_CHARS} caracteres por límite del prompt — el recorte es NUESTRO, no un defecto del código; júzgalo por lo visible y dilo en tus razones.`
      : "",
    "```diff", diff, "```",
  ].filter(Boolean).join("\n");
}

/**
 * Judge a scored tournament: rank finalists, escalate on tie/disagreement.
 * @returns {Promise<{winner: string, judge: string|null, escalated: boolean, walkover?: boolean}>}
 */
export async function judgeTournament({ tournamentDir, config = {}, logger = console, deps = {} }) {
  const { judgeFn = defaultJudge, agentFn = defaultAgent, solomonFn = null } = deps;
  const board = JSON.parse(fs.readFileSync(path.join(tournamentDir, "scoreboard.json"), "utf8"));
  const finalists = board.rows.filter((r) => r.finalist).map((r) => r.coder);
  const participants = board.rows.map((r) => r.coder);

  if (finalists.length === 0) throw new Error("tournament: sin finalistas (todas las suites rojas) — no hay nada que juzgar");
  if (finalists.length === 1) {
    const judgement = { winner: finalists[0], judge: null, escalated: false, walkover: true, board_ranking: board.ranking };
    fs.writeFileSync(path.join(tournamentDir, "judgement.json"), JSON.stringify(judgement, null, 2));
    logger?.info?.(`torneo ${board.id}: ganador por walkover — ${finalists[0]} (único finalista)`);
    return judgement;
  }

  const judge = await judgeFn({ config, participants });
  if (!judge) {
    throw new Error(
      "tournament: sin juez limpio — todos los agentes disponibles compitieron o son el host. " +
      "Un participante jamás juzga su propio torneo: quita un coder o añade un agente."
    );
  }

  const prompt = [
    "Eres el JUEZ de un torneo de código: varios coders resolvieron la MISMA tarea de forma independiente.",
    "La fase determinista ya eliminó a los que suspendieron la suite. Tu trabajo: ordenar a los finalistas",
    "por calidad de solución (diseño, legibilidad, ausencia de sobre-ingeniería), con el scoreboard a la vista.",
    `Regla del scoreboard: ${board.rule}`,
    `Ranking del scoreboard: ${board.ranking.join(" > ")}`,
    `TAREA ORIGINAL:\n${board.task}`,
    ...finalists.map((c) => finalistBlock(board, tournamentDir, c)),
    'Responde SOLO con JSON: {"ranking": ["coder", ...], "reasons": {"coder": "por qué"}, "tie": false}',
    "Declara tie:true únicamente si de verdad no puedes distinguirlos.",
  ].join("\n\n");

  logger?.info?.(`torneo ${board.id}: juez=${judge} sobre ${finalists.length} finalistas`);
  const res = await agentFn({ judge, prompt, config, logger });
  if (!res?.ok) throw new Error(`tournament: el juez ${judge} falló: ${res?.error || "sin salida"}`);
  let verdict;
  try {
    verdict = JSON.parse(String(res.output).replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
  } catch {
    throw new Error(`tournament: el juez ${judge} no devolvió un veredicto parseable`);
  }
  // An LLM verdict is untrusted input: the ranking must name FINALISTS and
  // nobody else — a hallucinated coder must fail loud, never get crowned.
  const isFinalist = (c) => finalists.includes(c);
  if (!Array.isArray(verdict.ranking) || verdict.ranking.length === 0 || !verdict.ranking.every(isFinalist)) {
    throw new Error(`tournament: ranking del juez inválido (${JSON.stringify(verdict.ranking)}) — debe nombrar solo finalistas: ${finalists.join(", ")}`);
  }

  // Only FIRST place crowns a winner: a judge that reorders lower positions
  // but agrees on who wins is agreement, not a dispute for solomon.
  const judgeTop = verdict.ranking?.[0];
  const boardTop = board.ranking[0];
  const disagreement = judgeTop !== boardTop;
  const escalated = Boolean(verdict.tie || disagreement);

  let winner = judgeTop;
  let solomon = null;
  if (escalated) {
    if (!solomonFn) {
      const why = verdict.tie ? "empate declarado" : `discrepancia juez(${judgeTop}) vs scoreboard(${boardTop})`;
      throw new Error(`tournament: ${why} y sin árbitro configurado`);
    }
    solomon = await solomonFn({
      judgeRanking: verdict.ranking,
      boardRanking: board.ranking,
      reasons: verdict.reasons,
      tie: Boolean(verdict.tie),
    });
    if (!isFinalist(solomon?.winner)) {
      throw new Error(`tournament: solomon devolvió un ganador inválido (${solomon?.winner}) — debe ser finalista`);
    }
    winner = solomon.winner;
  }

  const judgement = {
    winner, judge, escalated,
    judge_ranking: verdict.ranking, judge_reasons: verdict.reasons || {},
    board_ranking: board.ranking, solomon,
    judged_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(tournamentDir, "judgement.json"), JSON.stringify(judgement, null, 2));
  logger?.info?.(`torneo ${board.id}: ganador=${winner}${escalated ? " (vía solomon)" : " (juez y scoreboard de acuerdo)"}`);
  return judgement;
}

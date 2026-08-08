/**
 * `kj tournament` (KJC-TSK-0723, TOR-A) — fan the SAME task out to N coders
 * in N isolated worktree lanes and collect the evidence. The deterministic
 * scoreboard (TOR-B) and the governed judgement/merge (TOR-C) build on the
 * artifacts this command leaves under .kj/tournaments/<id>/.
 */
import path from "node:path";
import { runTournament } from "../tournament/run.js";
import { scoreTournament } from "../tournament/scoreboard.js";

export async function tournamentCommand({
  task, config, logger = console, flags = {},
  runTournamentFn = runTournament, scoreTournamentFn = scoreTournament,
}) {
  // TOR-B: `--score <id>` scores an EXISTING tournament from its artifacts.
  if (flags.score) {
    // The id feeds a path — same traversal class codex caught in TOR-A's
    // coder names: strict slug, no separators, before any filesystem use.
    const id = String(flags.score);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id)) {
      throw new Error(`tournament: id inválido "${id}" — usa el id que imprimió el torneo (p. ej. tor-abc123)`);
    }
    const tournamentDir = path.join(config?.projectDir || process.cwd(), ".kj", "tournaments", id);
    const board = await scoreTournamentFn({ tournamentDir });
    if (flags.json) {
      logger?.info?.(JSON.stringify(board));
      return board;
    }
    logger?.info?.(`scoreboard ${board.id} — regla: ${board.rule}`);
    for (const r of board.rows) {
      if (!r.finalist) {
        logger?.info?.(`  ${r.coder.padEnd(10)} eliminado (${r.eliminated_by})`);
        continue;
      }
      const mut = typeof r.mutation?.score === "number" ? `${r.mutation.score}%` : "n/a";
      logger?.info?.(`  ${r.coder.padEnd(10)} FINALISTA  loc:${String(r.loc.net).padStart(5)}  tests:${r.loc.testsTouched}  mutation:${mut}`);
    }
    logger?.info?.(`  ranking: ${board.ranking.join(" > ") || "(sin finalistas)"}`);
    return board;
  }

  if (!task || !String(task).trim()) {
    throw new Error("tournament: falta la tarea — kj tournament \"<tarea>\" --coders claude,codex");
  }
  const coders = String(flags.coders || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (coders.length < 2) {
    throw new Error("tournament: hacen falta al menos 2 en --coders — p. ej. --coders claude,codex,agy (con uno no hay torneo)");
  }

  const res = await runTournamentFn({ task, coders, config, logger });

  const completed = res.lanes.filter((l) => l.status === "completed");
  const green = completed.filter((l) => l.suite?.ok);
  logger?.info?.("");
  logger?.info?.(`torneo ${res.id}: ${completed.length}/${res.lanes.length} carriles completados, ${green.length} con suite verde`);
  logger?.info?.(`  evidencia: ${res.dir}`);
  logger?.info?.("  siguiente: el scoreboard determinista (TOR-B) puntuará los carriles; de momento compara los diff.patch a mano.");
  return res;
}

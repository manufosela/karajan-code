/**
 * `kj tournament` (KJC-TSK-0723, TOR-A) — fan the SAME task out to N coders
 * in N isolated worktree lanes and collect the evidence. The deterministic
 * scoreboard (TOR-B) and the governed judgement/merge (TOR-C) build on the
 * artifacts this command leaves under .kj/tournaments/<id>/.
 */
import { runTournament } from "../tournament/run.js";

export async function tournamentCommand({ task, config, logger = console, flags = {}, runTournamentFn = runTournament }) {
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

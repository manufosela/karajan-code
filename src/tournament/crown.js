/**
 * tournament/crown — TOR-C (KJC-TSK-0725, epic KJC-PCS-0073). The last act:
 * the tournament winner enters main THROUGH THE NORMAL DOOR, not around it.
 *
 * In the winner's still-alive lane: stage everything, run the real cross-AI
 * review over the EXACT staged diff (verdict bound to its sha256, stored by
 * the same verdict-store every commit uses), then commit — where the
 * pre-commit gate validates that verdict like any other commit's. A
 * rejected review ABORTS the coronation with the reasons: winning the
 * tournament earns you a candidacy, not a bypass. Losers keep their full
 * dossier under the tournament dir; their lanes are never removed here.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runOneShotReview } from "../review/one-shot-review.js";

const execFileAsync = promisify(execFile);

const defaultExec = async (cmd, args, { cwd }) => {
  const res = await execFileAsync(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return { exitCode: 0, stdout: res.stdout || "" };
};

async function defaultReview({ lane, task, config, logger }) {
  const { stdout: diff } = await execFileAsync("git", ["diff", "--cached"], { cwd: lane, maxBuffer: 64 * 1024 * 1024 });
  try {
    const record = await runOneShotReview({
      diff,
      task: `Tournament winner review. Original task:\n${task}`,
      config: { ...config, projectDir: lane },
      logger,
      projectDir: lane,
    });
    return { ok: record.verdict === "approved", ...record };
  } catch (err) {
    return { ok: false, verdict: "error", error: err.message };
  }
}

/**
 * Crown the judged winner: governed review + commit in its lane.
 * @returns {Promise<{winner: string, branch: string, commit: string, verdict: object}>}
 */
export async function crownWinner({ tournamentDir, config = {}, logger = console, cardRef = null, deps = {} }) {
  const { execFn = defaultExec, reviewFn = defaultReview } = deps;

  const judgementPath = path.join(tournamentDir, "judgement.json");
  if (!fs.existsSync(judgementPath)) {
    throw new Error("tournament: no hay judgement.json — corre primero kj tournament --judge <id>");
  }
  const judgement = JSON.parse(fs.readFileSync(judgementPath, "utf8"));
  const summary = JSON.parse(fs.readFileSync(path.join(tournamentDir, "summary.json"), "utf8"));
  const winner = judgement.winner;
  const meta = JSON.parse(fs.readFileSync(path.join(tournamentDir, winner, "meta.json"), "utf8"));
  const lane = meta.lane;
  if (!lane || !fs.existsSync(lane)) {
    throw new Error(`tournament: el carril del ganador (${winner}) ya no existe — corona justo después de juzgar, antes de limpiar carriles`);
  }

  logger?.info?.(`coronando a ${winner} en ${meta.branch} — por la puerta normal, no por un atajo`);
  await execFn("git", ["add", "-A"], { cwd: lane });

  const verdict = await reviewFn({ lane, task: summary.task, config, logger });
  if (!verdict?.ok) {
    const issues = (verdict?.issues || []).map((i) => `  - ${i.description}`).join("\n");
    throw new Error(
      `tournament: la review RECHAZÓ al ganador (${winner}) — ganar el torneo da candidatura, no bypass.\n${issues || verdict?.error || ""}`
    );
  }

  const ref = cardRef ? ` (${cardRef})` : "";
  const msg = `feat(tournament): crown ${winner} — ${String(summary.task).slice(0, 50).toLowerCase()}${ref} [${summary.id}]`;
  await execFn("git", ["commit", "-m", msg], { cwd: lane });
  const { stdout } = await execFn("git", ["rev-parse", "HEAD"], { cwd: lane });
  const commit = stdout.trim();

  const crown = {
    winner, branch: meta.branch, commit,
    verdict: { verdict: verdict.verdict, reviewer: verdict.reviewer, diffHash: verdict.diffHash },
    crowned_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(tournamentDir, "crown.json"), JSON.stringify(crown, null, 2));
  logger?.info?.(`✓ coronado: ${winner} · commit ${commit.slice(0, 9)} en ${meta.branch} — la rama queda lista para PR`);
  logger?.info?.("  los perdedores conservan su expediente en el dir del torneo; limpia carriles con kj worktree done cuando quieras");
  return { winner, branch: meta.branch, commit, verdict: crown.verdict };
}

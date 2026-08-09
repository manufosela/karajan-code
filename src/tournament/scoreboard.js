/**
 * tournament/scoreboard — TOR-B (KJC-TSK-0724, epic KJC-PCS-0073).
 *
 * The deterministic half of "merge the winner": pure metrics computed from
 * the artifacts TOR-A leaves under .kj/tournaments/<id>/ (suite verdict,
 * net LOC, tests touched — parsed from diff.patch), plus injectable
 * external metrics (mutation via `kj mutate` in the still-alive lane;
 * sonar reserved) that degrade HONESTLY to null-with-note when their tool
 * is unavailable — a fake zero would poison the ranking. Red suites are
 * eliminated, never finalists. The ranking rule is lexicographic and
 * PRINTED with the result: no opaque composite scores, no hidden weights.
 * Zero LLM in this whole phase.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TESTS_RE = /(?:(?:^|\/)(?:tests?|__tests__|spec)\/)|(?:\.(?:test|spec)\.[a-z]+$)/;
const MUTATE_TIMEOUT_MS = 10 * 60 * 1000;

// EXACT unified-diff header forms — an added line whose content starts with
// "++" produces "+++<content>" and must still COUNT (codex's catch): only
// `+++ b/…`, `+++ /dev/null`, `--- a/…`, `--- /dev/null` are headers.
const ADD_HEADER_RE = /^\+\+\+ (b\/|\/dev\/null)/;
const DEL_HEADER_RE = /^--- (a\/|\/dev\/null)/;

/** Pure unified-diff stats: files, additions/deletions/net, tests touched. */
export function parseDiffStats(patch) {
  const files = [];
  let additions = 0;
  let deletions = 0;
  for (const line of String(patch || "").split("\n")) {
    if (ADD_HEADER_RE.test(line)) {
      if (line.startsWith("+++ b/")) files.push(line.slice(6).trim());
    } else if (DEL_HEADER_RE.test(line)) {
      // deletion-side header — never a counted line
    } else if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  const testsTouched = files.filter((f) => TESTS_RE.test(f)).length;
  return { files, additions, deletions, net: additions - deletions, testsTouched };
}

export async function defaultMutate({ lane }) {
  // Mutation runs IN the live worktree lane — codex's catch: guard the path
  // explicitly so a gone/relative lane yields a DISTINCT note instead of
  // silently degrading the ranking.
  if (!lane || !path.isAbsolute(lane) || !fs.existsSync(lane)) {
    return { score: null, note: "lane no longer exists — score after the fan-out, before cleaning lanes" };
  }
  try {
    const res = await execFileAsync("kj", ["mutate", "--json"], { cwd: lane, timeout: MUTATE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const parsed = JSON.parse(res.stdout);
    return { score: parsed.score ?? null, killed: parsed.killed ?? null, survived: parsed.survived ?? null };
  } catch {
    return null; // kj unavailable / no mutants / timeout — honest n/a
  }
}

// Sonar-per-lane needs the running-server collector; reserved as a future
// step (see card). Injectable so TOR-C or tests can supply real findings.
const defaultSonar = async () => null;

/**
 * Score every lane of a tournament from its artifacts.
 * @returns {Promise<{id: string, rows: Array<object>, ranking: string[], rule: string}>}
 */
export async function scoreTournament({ tournamentDir, deps = {} }) {
  const { mutateFn = defaultMutate, sonarFn = defaultSonar } = deps;
  const summary = JSON.parse(fs.readFileSync(path.join(tournamentDir, "summary.json"), "utf8"));

  const rows = [];
  for (const lane of summary.lanes) {
    if (lane.status !== "completed") {
      rows.push({ coder: lane.coder, finalist: false, eliminated_by: "failed", error: lane.error || null });
      continue;
    }
    const laneDir = lane.dir || path.join(tournamentDir, lane.coder);
    const meta = JSON.parse(fs.readFileSync(path.join(laneDir, "meta.json"), "utf8"));
    const loc = parseDiffStats(fs.readFileSync(path.join(laneDir, "diff.patch"), "utf8"));

    let mutation = { score: null, note: "not available" };
    try {
      const m = await mutateFn({ coder: lane.coder, lane: meta.lane, laneDir });
      if (m && typeof m.score === "number") mutation = { ...m, note: null };
      else if (m?.note) mutation = { score: null, note: m.note };
    } catch { /* honest n/a — never a fake zero */ }
    const sonar = await sonarFn({ coder: lane.coder, lane: meta.lane, files: loc.files }).catch(() => null);

    const suiteOk = Boolean(meta.suite?.ok);
    rows.push({
      coder: lane.coder,
      finalist: suiteOk,
      eliminated_by: suiteOk ? null : "suite",
      suite: meta.suite,
      loc,
      mutation,
      sonar,
    });
  }

  const anyMutation = rows.some((r) => typeof r.mutation?.score === "number");
  const rule = anyMutation
    ? "finalistas = suite verde; orden: mutation desc SOLO entre carriles que la tienen (null jamás penaliza — codex's catch), luego LOC neto asc"
    : "finalistas = suite verde; orden: LOC neto asc (mutation no disponible)";

  const ranking = rows
    .filter((r) => r.finalist)
    .sort((a, b) => {
      const ma = a.mutation?.score;
      const mb = b.mutation?.score;
      // Mutation only compares when BOTH lanes have a real score — a null
      // (tool unavailable) must stay a note, never become a hidden penalty.
      if (typeof ma === "number" && typeof mb === "number" && mb !== ma) return mb - ma;
      return a.loc.net - b.loc.net;
    })
    .map((r) => r.coder);

  const board = { id: summary.id, task: summary.task, rule, ranking, rows, scored_at: new Date().toISOString() };
  fs.writeFileSync(path.join(tournamentDir, "scoreboard.json"), JSON.stringify(board, null, 2));
  return board;
}

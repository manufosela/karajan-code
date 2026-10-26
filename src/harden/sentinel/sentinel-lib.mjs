// kj sentinel shared lib (KJC-TSK-0714) — managed by `kj harden`.
// Single source for every sentinel script: state, branch, classification,
// and violations.
import process from "node:process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
// KJC-TSK-1202 (ADR 0030): installed in a project the guard sits in .karajan/harness,
// two levels below its root; run from the kj package, the project is the one the
// host names (CLAUDE_PROJECT_DIR) or the working directory, at its git root.
const installed = basename(here) === "harness" && basename(dirname(here)) === ".karajan";
const projectRoot = () => {
  const start = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try { return execSync("git rev-parse --show-toplevel", { cwd: start, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || start; }
  catch { return start; }
};
export const ROOT = installed ? join(here, "..", "..") : projectRoot();
export const STATE = join(ROOT, ".karajan", "harness", "sentinel-state.json");
// INF-A (KJC-TSK-0758): infra IS source — terraform/k8s/shell/Docker edits
// engage the method like app code; *_test.* files (terratest) are tests.
export const TESTS = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$/;
export const CODE = /\.(m?[jt]sx?|c[jt]s|py|go|rs|java|rb|php|cs|swift|kt|astro|svelte|vue|c|h|cc|cpp|hpp|tf|hcl|ya?ml|sh)$|(^|\/)(Dockerfile|Makefile|Vagrantfile)$/;
export const CARD = new RegExp("\\b[a-z][a-z0-9]{1,9}(?:-[a-z][a-z0-9]{1,9})*-\\d{1,6}\\b(?!\\.\\d)", "i");
export const BASE_BRANCHES = new Set(["main", "master"]);
export const load = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; } };
export const save = (state) => {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2));
};
export const doc = (a) => " — doc: https://karajancode.com/docs/guides/sentinel/#" + a;
export const session = (state, sid) => {
  state.sessions ||= {};
  return (state.sessions[sid] ||= { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0 });
};
const _git = (args, cwd) => {
  try { return execSync("git " + args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
};
// MONO-0 (ADR 0002, amended by #2566): lane identity = worktree toplevel; repo
// identity = git-common-dir. The session's lane is where the HOST says it works
// (the hook payload's cwd, which EnterWorktree moves) when that is a worktree of
// this same repo; otherwise the dir the guard is installed in.
let _home;
const homeOf = (dir) => ({ top: _git("rev-parse --show-toplevel", dir), common: _git("rev-parse --path-format=absolute --git-common-dir", dir) });
// ADR 0033 (KJC-TSK-1236): a session switches into a lane only when no other live session
// is there. Each session keeps one presence mark (its lane and when it last called a hook)
// in the repo's git common dir. Entering is intent first, then a look: the session writes
// the new lane, then reads the others' marks and steps back if another live one is there.
// Two sessions entering together never both stay: the later write is seen by the later look.
const LANE_TTL_MS = 30 * 60 * 1000;
const laneKey = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
let _refusal = null;
/** Why the last enterLane kept the session out of the lane its cwd is in, or null. */
export const laneRefusal = () => _refusal;
export const enterLane = (cwd, sid = null, now = Date.now()) => {
  const root = homeOf(ROOT);
  const here = cwd ? homeOf(cwd) : null;
  // git that cannot answer ("" common dir) never matches: fail closed to the install lane.
  let lane = here?.top && root.common && here.common === root.common ? here : root;
  _refusal = null;
  if (sid && root.common) {
    const dir = join(root.common, "kj-lanes");
    const mark = join(dir, "session-" + laneKey(sid) + ".json");
    const write = (top) => writeFileSync(mark, JSON.stringify({ sid, lane: top, at: now }));
    try {
      mkdirSync(dir, { recursive: true });
      const prev = readJson(mark);
      const kept = prev?.lane === lane.top && now - prev.at < LANE_TTL_MS;
      if (lane.top !== root.top && !kept) {
        write(lane.top);
        const other = readdirSync(dir).filter((f) => f.startsWith("session-")).map((f) => readJson(join(dir, f)))
          .find((r) => r && r.sid !== sid && r.lane === lane.top && now - r.at < LANE_TTL_MS);
        if (other) {
          _refusal = "(" + lane.top + " tiene otra sesión viva: un carril, una sesión, ADR 0033)";
          lane = root;
        }
      }
      write(lane.top);
    } catch {
      if (lane.top !== root.top) {
        _refusal = "(no se pudo reclamar " + lane.top + ")";
        lane = root;
        // Best effort: a mark left in the refused lane would keep others out for 30 min.
        try { write(root.top); } catch { /* the session stays home either way */ }
      }
    }
  }
  _home = lane;
  return _home.top;
};
export const laneTop = () => (_home ||= homeOf(ROOT)).top || ROOT;
export const branchOf = () => {
  try { return execSync("git rev-parse --abbrev-ref HEAD", { cwd: laneTop(), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
};
// Same repo but another toplevel than OUR lane => foreign lane (its toplevel); else null.
export const foreignLane = (targetDir) => {
  const top = _git("rev-parse --show-toplevel", targetDir);
  if (!top) return null;
  _home ||= homeOf(ROOT);
  if (!_home.top || top === _home.top) return null;
  const common = _git("rev-parse --path-format=absolute --git-common-dir", targetDir);
  return common && common === _home.common ? top : null;
};
// KJC-TSK-0765 board-sync: cards merged in this session but not yet moved in
// the tracker. The method does not advance until the board is true.
export const pendingMoves = (s) => (s && Array.isArray(s.pending_moves) ? s.pending_moves : []);
export const pendingText = (p) => (p.card ? p.card : "card sin identificar") + " (PR #" + p.pr + ") mergeada sin mover en el tracker — muevela a To Validate / Fixed con sus commits (update_card del PG o kj hu move)";
// KJC-BUG-0185: bootstrap phase = the repo has no commit yet. There is no base
// branch to protect and no coverage to demand over a tree that does not exist,
// and `git diff HEAD` cannot even run. The phase is a verifiable FACT, never a
// flag, and it ends at the first commit.
export const bootstrapPhase = () => {
  try { execSync("git rev-parse --verify HEAD", { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] }); return false; }
  catch { return true; }
};
// KJC-BUG-0198/0262: a card split across PRs is carried while another PR of it is
// open. kj decides with that checkable fact, the same answer for commit and push
// (the Stop gate still holds the turn: the board owes the move); when kj does not
// answer, every pending move blocks.
export const boardGate = (sid, pend) => {
  if (!pend.length) return { blocking: [], carried: [] };
  const bg = spawnSync("kj", ["sentinel", "board-gate", "--session", sid, "--json"], { cwd: ROOT, encoding: "utf8" });
  if (!bg.error && (bg.status === 0 || bg.status === 2)) {
    try { const d = JSON.parse(bg.stdout); return { blocking: d.blocking || [], carried: d.carried || [], reason: d.reason || "" }; } catch { /* unreadable: as always */ }
  }
  return { blocking: pend, carried: [] };
};
// KJC-BUG-0265: on the base branch what counts is work still there (the session's
// files dirty, or local commits the remote does not have), not the ledger: after a
// merged PR and a sync of main the ledger stays full while the base holds nothing.
// Anything git cannot answer (no upstream, odd path) counts as work: fail closed.
const baseHoldsWork = (files) => {
  if (files.some((f) => !/^[A-Za-z0-9._/-]+$/.test(f))) return true;
  try {
    if (execSync("git status --porcelain -- " + files.join(" "), { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()) return true;
    return execSync("git rev-list @{u}..HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
  } catch { return true; }
};
export const violations = (s, branch, pending = pendingMoves(s)) => {
  const v = pending.map(pendingText);
  if (!s || !(s.edited_sources || []).length) return v;
  if (bootstrapPhase()) return v;
  if (BASE_BRANCHES.has(branch)) { if (baseHoldsWork(s.edited_sources)) v.push("Fuentes editadas en la rama base '" + branch + "' — crea una rama: git checkout -b feat/<CARD-ID>-descripcion"); }
  else if (branch && !CARD.test(branch)) v.push("La rama '" + branch + "' no referencia ninguna card — usa feat/<CARD-ID>-descripcion (y una card VIVA en el board)");
  if (!(s.edited_tests || []).length && sessionAddsCode(s)) v.push("Fuentes editadas sin tocar un solo test (" + s.edited_sources.join(", ") + ") — escribe o actualiza el test que prueba el cambio");
  return v;
};
// KJC-TSK-0795 AC1: deleting code adds no behavior to test — a session whose
// source edits only REMOVED lines owes no test. Unreadable git = conservative
// (the violation stands): a gate must never stand down on a shrug.
const sessionAddsCode = (s) => {
  const files = s.edited_sources || [];
  // _git builds a shell string: any path outside a strict charset stays out of
  // it — and the gate stays ARMED for it (conservative, and injection-proof).
  if (files.some((f) => !/^[A-Za-z0-9._/-]+$/.test(f))) return true;
  const stat = _git("diff HEAD --numstat -- " + files.join(" "), ROOT);
  if (!stat) return true;
  return stat.split(String.fromCharCode(10)).some((l) => {
    const a = l.trim().replaceAll(String.fromCharCode(9), " ").split(" ").filter(Boolean)[0];
    return a === "-" || Number(a) > 0;
  });
};

// kj sentinel shared lib (KJC-TSK-0714) — managed by `kj harden`.
// Single source for every sentinel script: state, branch, classification,
// and violations.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
export const STATE = join(here, "sentinel-state.json");
export const ROOT = join(here, "..", "..");
// INF-A (KJC-TSK-0758): infra IS source — terraform/k8s/shell/Docker edits
// engage the method like app code; *_test.* files (terratest) are tests.
export const TESTS = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$/;
export const CODE = /\.(m?[jt]sx?|c[jt]s|py|go|rs|java|rb|php|cs|swift|kt|astro|svelte|vue|c|h|cc|cpp|hpp|tf|hcl|ya?ml|sh)$|(^|\/)(Dockerfile|Makefile|Vagrantfile)$/;
export const CARD = new RegExp("\\b[a-z][a-z0-9]{1,9}(?:-[a-z][a-z0-9]{1,9})*-\\d{1,6}\\b(?!\\.\\d)", "i");
export const BASE_BRANCHES = new Set(["main", "master"]);
export const load = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; } };
export const save = (state) => writeFileSync(STATE, JSON.stringify(state, null, 2));
export const doc = (a) => " — doc: https://karajancode.com/docs/guides/sentinel/#" + a;
export const session = (state, sid) => {
  state.sessions ||= {};
  return (state.sessions[sid] ||= { edited_sources: [], edited_tests: [], escapes: [], errors: [], blocks: 0 });
};
export const branchOf = () => {
  try { return execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
};
const _git = (args, cwd) => {
  try { return execSync("git " + args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
};
let _home;
// MONO-0 (ADR 0002): lane identity = worktree toplevel; repo identity =
// git-common-dir. Same repo but another toplevel than OUR root => foreign
// lane (returns its toplevel); anything else => null.
export const foreignLane = (targetDir) => {
  const top = _git("rev-parse --show-toplevel", targetDir);
  if (!top) return null;
  _home ||= { top: _git("rev-parse --show-toplevel", ROOT), common: _git("rev-parse --path-format=absolute --git-common-dir", ROOT) };
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

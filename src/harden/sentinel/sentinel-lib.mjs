// kj sentinel shared lib (KJC-TSK-0714) — managed by `kj harden`.
// Single source for every sentinel script: state, branch, classification,
// and violations.
import process from "node:process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
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
// this same repo; otherwise the dir the guard is installed in. ROOT keeps the
// harness (state, config); laneTop() is the git tree the session works in.
// ADR 0033 (KJC-TSK-1236): a session switches into a lane only when no other live session
// is there. Each session keeps one presence mark (its lane and when it last resolved it) in
// the repo's git common dir. Entering is intent first, then a look: the session writes the
// new lane, then reads the others' marks and steps back if another live one is there. Two
// sessions entering together never both stay: the later write is seen by the later look.
const LANE_TTL_MS = 30 * 60 * 1000;
let _cwd = null;
let _sid = null;
let _home;
let _refusal = null;
const homeOf = (dir) => {
  const [top = "", common = ""] = _git("rev-parse --show-toplevel --path-format=absolute --git-common-dir", dir).split("\n");
  return { top, common };
};
export const enterLane = (_state, sid, cwd) => {
  _cwd = cwd;
  _sid = sid;
  _home = undefined;
  _refusal = null;
};
/** Why the session was kept out of the lane its cwd is in, or null. */
export const laneRefusal = () => _refusal;
const laneKey = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const live = (at, now) => typeof at === "number" && now - at < LANE_TTL_MS;
// ADR 0034: a mark also lists the lanes the session wrote in (`held`); another session holds
// a lane when it is in it or wrote there within the period. Another session's mark that cannot
// be read or parsed throws: the caller refuses rather than read it as a free lane.
const heldByOther = (dir, top, now) => readdirSync(dir).filter((f) => f.startsWith("session-"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
  .some((r) => r?.sid !== _sid && ((r?.lane === top && live(r.at, now)) || live(r?.held?.[top], now)));
const liveHeld = (mark, now) => Object.fromEntries(Object.entries(mark?.held ?? {}).filter(([, at]) => live(at, now)));
// The lane the session may take: `lane` when it is home, already its live lane, or free.
const claimLane = (root, lane, now = Date.now()) => {
  if (!_sid || !root.common) return lane;
  const dir = join(root.common, "kj-lanes");
  const mark = join(dir, "session-" + laneKey(_sid) + ".json");
  const write = (top) => writeFileSync(mark, JSON.stringify({ sid: _sid, lane: top, at: now, held: liveHeld(readJson(mark), now) }));
  try {
    mkdirSync(dir, { recursive: true });
    const prev = readJson(mark);
    if (lane.top !== root.top && !(prev?.lane === lane.top && live(prev.at, now))) {
      write(lane.top);
      if (heldByOther(dir, lane.top, now)) {
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
  return lane;
};
// Resolved on first use: a hook that never asks git pays no spawn.
const home = () => {
  if (_home) return _home;
  const root = homeOf(ROOT);
  const here = _cwd ? homeOf(_cwd) : null;
  // git that cannot answer ("" common dir) never matches: fail closed to the install lane.
  return (_home = claimLane(root, here?.top && root.common && here.common === root.common ? here : root));
};
export const laneTop = () => home().top || ROOT;
/**
 * ADR 0034 (KJC-TSK-1244): why the session may not write in lane `top`, or null once it holds it.
 * Intent first, then a look, as a switch does (ADR 0033): the hold is written, then another
 * live session in that lane takes it back out. Anything unreadable refuses.
 */
export const holdLane = (top, now = Date.now()) => {
  const own = home();
  if (top === laneTop()) return null;
  if (!_sid || !own.common) return "(sin sesión identificada no se reclama " + top + ")";
  const dir = join(own.common, "kj-lanes");
  const mark = join(dir, "session-" + laneKey(_sid) + ".json");
  try {
    mkdirSync(dir, { recursive: true });
    const mine = { sid: _sid, lane: own.top, at: now, ...readJson(mark) };
    const held = liveHeld(mine, now);
    writeFileSync(mark, JSON.stringify({ ...mine, held: { ...held, [top]: now } }));
    if (!heldByOther(dir, top, now)) return null;
    writeFileSync(mark, JSON.stringify({ ...mine, held }));
    return "(" + top + " tiene otra sesión viva: un carril, una sesión, ADR 0033/0034)";
  } catch {
    return "(no se pudo reclamar " + top + ")";
  }
};
export const branchOf = (top = laneTop()) => {
  try { return execSync("git rev-parse --abbrev-ref HEAD", { cwd: top, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
};
// ADR 0034 (KJC-TSK-1243): the lane a write lands in is the worktree holding its path when
// that worktree is of this repo; any other path is judged in the session's lane. It walks up
// to the first existing dir (a subdir not created yet escaped) and canonicalizes it (a local
// symlink into another lane was classified by its literal path).
export const laneFor = (p) => {
  let d = String(p);
  while (d && !(existsSync(d) && statSync(d).isDirectory())) {
    const up = dirname(d);
    if (up === d) return laneTop();
    d = up;
  }
  try { d = realpathSync(d); } catch { /* classified as is */ }
  const target = homeOf(d);
  const own = home();
  return target.top && own.top && target.common && target.common === own.common ? target.top : laneTop();
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
// KJC-BUG-0455 (#2933): the cross-AI verdict of the diff staged in `dir`, read the way
// `kj review --check` reads it (sha256 of `git diff --cached`, trailing blanks trimmed,
// in <top>/.karajan/reviews). gate:false when the repo has not committed the gate marker.
// state: approved | rejected | missing | empty (nothing staged) | unknown (git failed).
export const stagedVerdict = (dir) => {
  const git = (args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (git(["cat-file", "-e", "HEAD:.karajan/review-gate"]).status !== 0) return { gate: false };
  const top = git(["rev-parse", "--show-toplevel"]).stdout?.trim();
  const diff = git(["diff", "--cached"]);
  if (!top || diff.status !== 0) return { gate: true, state: "unknown" };
  if (!diff.stdout.trim()) return { gate: true, state: "empty" };
  const hash = createHash("sha256").update(diff.stdout.trimEnd(), "utf8").digest("hex");
  try {
    const v = JSON.parse(readFileSync(join(top, ".karajan", "reviews", hash + ".json"), "utf8"));
    return { gate: true, state: v.verdict === "approved" ? "approved" : "rejected", reviewer: v.reviewer || null };
  } catch { return { gate: true, state: "missing" }; }
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
const baseHoldsWork = (files, top) => {
  if (files.some((f) => !/^[A-Za-z0-9._/-]+$/.test(f))) return true;
  try {
    if (execSync("git status --porcelain -- " + files.join(" "), { cwd: top, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()) return true;
    return execSync("git rev-list @{u}..HEAD", { cwd: top, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
  } catch { return true; }
};
// `top` is the tree the recorded paths are relative to: ROOT, or another lane (ADR 0034).
// laneViolations: those of every other lane the session wrote in, each named by its lane.
export const laneViolations = (s) => Object.entries(s?.lanes ?? {})
  .flatMap(([top, rec]) => violations(rec, branchOf(top), [], top).map((x) => "[" + top + "] " + x));
export const violations = (s, branch, pending = pendingMoves(s), top = ROOT) => {
  const v = pending.map(pendingText);
  if (!s || !(s.edited_sources || []).length) return v;
  if (bootstrapPhase()) return v;
  if (BASE_BRANCHES.has(branch)) { if (baseHoldsWork(s.edited_sources, top)) v.push("Fuentes editadas en la rama base '" + branch + "' — crea una rama: git checkout -b feat/<CARD-ID>-descripcion"); }
  else if (branch && !CARD.test(branch)) v.push("La rama '" + branch + "' no referencia ninguna card — usa feat/<CARD-ID>-descripcion (y una card VIVA en el board)");
  if (!(s.edited_tests || []).length && sessionAddsCode(s, top)) v.push("Fuentes editadas sin tocar un solo test (" + s.edited_sources.join(", ") + ") — escribe o actualiza el test que prueba el cambio");
  return v;
};
// KJC-TSK-0795 AC1: deleting code adds no behavior to test — a session whose
// source edits only REMOVED lines owes no test. Unreadable git = conservative
// (the violation stands): a gate must never stand down on a shrug.
const sessionAddsCode = (s, top) => {
  const files = s.edited_sources || [];
  // _git builds a shell string: any path outside a strict charset stays out of
  // it — and the gate stays ARMED for it (conservative, and injection-proof).
  if (files.some((f) => !/^[A-Za-z0-9._/-]+$/.test(f))) return true;
  const stat = _git("diff HEAD --numstat -- " + files.join(" "), top);
  if (!stat) return true;
  return stat.split(String.fromCharCode(10)).some((l) => {
    const a = l.trim().replaceAll(String.fromCharCode(9), " ").split(" ").filter(Boolean)[0];
    return a === "-" || Number(a) > 0;
  });
};

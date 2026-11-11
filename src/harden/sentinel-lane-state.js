/**
 * HU-3474 — the Sentinel state as `kj review` sees it from a lane.
 * A session that entered a lane through EnterWorktree keeps the host's project
 * dir on the MAIN tree, so the hooks write the state there (ADR 0034: one file
 * per repo, `sessions[sid].lanes[<top>]`). This reads that file for the lane,
 * narrowed to the sessions that belong to THIS lane, joined with the lane's own
 * harness state (where kj code's coder writes), whose entries win. The
 * Sentinel's layout is not changed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const STATE_PARTS = [".karajan", "harness", "sentinel-state.json"];
const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
const git = (dir, ...args) => {
  try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
};
/** Sessions whose presence mark (git common dir, written by the Sentinel) says they work in lane `top`. */
const sessionsMarkedIn = (common, top) => {
  try {
    return readdirSync(path.join(common, "kj-lanes")).filter((f) => f.startsWith("session-"))
      .map((f) => readJson(path.join(common, "kj-lanes", f))).filter((m) => m?.lane === top && m.sid).map((m) => m.sid);
  } catch { return []; }
};
/** [toplevel, git common dir] of `projectDir`, both absolute ("" when git cannot answer). */
const whereIs = (projectDir) => git(projectDir, "rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir").split("\n");
/**
 * @param {string} projectDir
 * @returns {object|null} the state (`{sessions}`) of that dir; for a lane without its own state, only this lane's sessions.
 */
export function readLaneSentinelState(projectDir) {
  const [top = "", common = ""] = whereIs(projectDir);
  const own = readJson(path.join(top || projectDir, ...STATE_PARTS));
  if (!top || !common) return own;
  const mainTop = path.dirname(common);
  if (mainTop === top) return own;
  const main = readJson(path.join(mainTop, ...STATE_PARTS));
  if (!main) return own;
  const marked = new Set(sessionsMarkedIn(common, top));
  const belongs = ([sid, s]) => marked.has(sid) || Boolean(s?.lanes?.[top]);
  const mainSessions = Object.fromEntries(Object.entries(main.sessions ?? {}).filter(belongs));
  // KJC-BUG-0552: kj code's coder writes the lane's own state and the orchestrator that entered the
  // lane is recorded in the main tree: both are this lane's sessions. The lane's own entry wins.
  if (own) return { ...own, sessions: { ...mainSessions, ...own.sessions } };
  return { ...main, sessions: mainSessions };
}

/**
 * KJC-BUG-0548: drop pending board moves of one session, in the file the state really lives in
 * (the lane's own, else the main tree's), re-read whole so no other session's state is lost.
 * @returns {boolean} whether the file was rewritten
 */
export function prunePendingMoves(projectDir, sessionId, cards) {
  const [top = "", common = ""] = whereIs(projectDir);
  const own = path.join(top || projectDir, ...STATE_PARTS);
  const file = readJson(own) || !common ? own : path.join(path.dirname(common), ...STATE_PARTS);
  const state = readJson(file);
  const s = state?.sessions?.[sessionId];
  if (!Array.isArray(s?.pending_moves)) return false;
  const drop = new Set(cards);
  s.pending_moves = s.pending_moves.filter((p) => !drop.has(String(p.card ?? "").toUpperCase()));
  // Atomic replace, so a reader never sees half a file. The hooks write this file the same
  // unlocked way; a concurrent write that brings a pruned move back is pruned again on the
  // next check (the prune is idempotent), and the gate keeps failing closed meanwhile.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
  return true;
}

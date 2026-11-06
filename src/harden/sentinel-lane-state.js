/**
 * HU-3474 — the Sentinel state as `kj review` sees it from a lane.
 * A session that entered a lane through EnterWorktree keeps the host's project
 * dir on the MAIN tree, so the hooks write the state there (ADR 0034: one file
 * per repo, `sessions[sid].lanes[<top>]`). This reads that file for the lane:
 * the lane's own harness state wins; otherwise the main tree's, narrowed to the
 * sessions that belong to THIS lane. The Sentinel's layout is not changed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
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
/**
 * @param {string} projectDir
 * @returns {object|null} the state (`{sessions}`) of that dir; for a lane without its own state, only this lane's sessions.
 */
export function readLaneSentinelState(projectDir) {
  const [top = "", common = ""] = git(projectDir, "rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir").split("\n");
  const own = readJson(path.join(top || projectDir, ...STATE_PARTS));
  if (own || !top || !common) return own;
  const mainTop = path.dirname(common);
  if (mainTop === top) return null;
  const main = readJson(path.join(mainTop, ...STATE_PARTS));
  if (!main) return null;
  const marked = new Set(sessionsMarkedIn(common, top));
  const belongs = ([sid, s]) => marked.has(sid) || Boolean(s?.lanes?.[top]);
  return { ...main, sessions: Object.fromEntries(Object.entries(main.sessions ?? {}).filter(belongs)) };
}

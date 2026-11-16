/**
 * Guard for the e2e suite: a kj subprocess must not leave a session of a
 * test project in the developer's real home. The board makes a project row
 * from the project_id of <home>/sessions/<session>/session.json, so that is
 * what is watched: the NAMES of the sessions before the run, and the
 * project_id (only) of each new one after it. Read-only.
 */

import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA = /kj-e2e|kj-sea|kj_e2e|kj_sea|private_tmp|private_var_folders|tmp_|var_folders/;

export function realBoardHome() {
  return process.env.REAL_KJ_HOME || path.join(os.homedir(), ".karajan");
}

export function snapshotBoardHome(home = realBoardHome()) {
  try { return readdirSync(path.join(home, "sessions")); } catch { return []; }
}

function projectIdOf(home, session) {
  try {
    const raw = JSON.parse(readFileSync(path.join(home, "sessions", session, "session.json"), "utf8"));
    return typeof raw?.project_id === "string" ? raw.project_id : "";
  } catch { return ""; }
}

export function assertBoardHomeUntouched(before, args, home = realBoardHome()) {
  const known = new Set(before);
  const leaked = snapshotBoardHome(home)
    .filter((s) => !known.has(s) && TEST_DATA.test(projectIdOf(home, s)));
  if (leaked.length === 0) return;
  throw new Error(`e2e guard: "kj ${args.join(" ")}" wrote a session of a test project into the real home ${home}: ${leaked.slice(0, 5).join(", ")}`);
}

/**
 * HU-4268 (#4259): the base branch kj works against. A base_branch somebody set
 * wins, then the remote's default branch (origin/HEAD, read locally, never the
 * network), then "main" with a note on how to fix it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config.js";

export const DEFAULT_BASE_BRANCH = "main";

/**
 * loadConfig puts "did a layer set base_branch" on the config it returns under this
 * key. A Symbol, non-enumerable: the merge, the YAML dump and JSON never see it.
 */
export const BASE_EXPLICIT = Symbol.for("kj.baseBranchExplicit");

const said = new Set();
// Once per process and message: a command resolves the base many times, the operator reads it once.
const stderrOnce = { info: (msg) => { if (!said.has(msg)) { said.add(msg); process.stderr.write(`${msg}\n`); } } };

function remoteDefaultBranch(projectDir) {
  try {
    const head = execFileSync("git", ["-C", projectDir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return head.trim().replace(/^origin\//, "") || null;
  } catch {
    return null; // no remote or no origin/HEAD
  }
}

/** HU-4424: the file, in a lane's own git dir, that names the base `kj worktree start --base` cut it from. */
export const LANE_BASE_FILE = "kj-base";

/** HU-4424: the base this lane was started on, or null (not a lane, or a lane started without --base). */
export function laneBase(projectDir) {
  try {
    const out = execFileSync("git", ["-C", projectDir, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const [gitDir, common] = out.trim().split("\n");
    if (!gitDir || gitDir === common) return null;
    return readFileSync(join(gitDir, LANE_BASE_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Synchronous: for callers that already hold a loaded config. `explicit` overrides the flag the config carries. */
export function baseBranchFrom({ config = null, explicit, projectDir = process.cwd(), logger = stderrOnce, announce = true, label = "kj" } = {}) {
  // HU-4424: a lane started with --base keeps it, before any project setting: the lane is that base's work.
  const lane = laneBase(projectDir);
  if (lane) return lane;
  // A config not made by loadConfig carries no flag: a value other than the default can only be somebody's choice.
  const isExplicit = explicit ?? config?.[BASE_EXPLICIT] ?? (!!config?.base_branch && config.base_branch !== DEFAULT_BASE_BRANCH);
  if (isExplicit && config?.base_branch) return config.base_branch;
  const branch = remoteDefaultBranch(projectDir);
  if (branch) {
    if (announce) logger.info?.(`kj: base branch ${branch} (from origin/HEAD)`);
    return branch;
  }
  logger.info?.(`${label}: could not read the default branch (no origin/HEAD); using ${DEFAULT_BASE_BRANCH}. Set base_branch in the kj config or run \`git remote set-head origin -a\`.`);
  return DEFAULT_BASE_BRANCH;
}

/** KJC-BUG-0233: loadConfig returns `{ config, ... }`; only a layer that set base_branch counts. */
export async function resolveBaseBranch(projectDir, { load = loadConfig, logger = {}, announce = false, label = "kj" } = {}) {
  let loaded = null;
  try {
    loaded = await load(projectDir);
  } catch {
    /* no kj config: the repository decides */
  }
  return baseBranchFrom({ config: loaded?.config ?? null, explicit: !!loaded?.baseBranchExplicit, projectDir, logger, announce, label });
}

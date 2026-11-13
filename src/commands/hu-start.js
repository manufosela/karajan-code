/**
 * `kj hu start <id> [slug]` (KJC-TSK-1372, #2853, step 7 of #2566): starting a task is one
 * step, in the order that works. In 5.0 the host agent does the work inside a lane, so a lane
 * that comes before its card gets its writes refused later. This command:
 * 1. finds the card and refuses, before creating anything, if it does not exist or someone else holds it;
 * 2. opens its lane with `kj worktree start <id>-<slug>` (feat/<id>-<slug> from origin/<base>, set up);
 * 3. moves the card to running, which claims it, and prints the cd.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { note } from "../agents/activity.js";
import { lanesByCard, parseLanes } from "../hu/lanes.js";
import { buildRoleSkillSection, roleSkills } from "../skills/role-skills.js";
import { detectHostAgent } from "../utils/agent-detect.js";
import { REF_SEPARATOR, worktreeCommand } from "./worktree.js";

const SLUG_MAX = 40;
const KJ_BIN = fileURLToPath(new URL("../../bin/kj.js", import.meta.url));

/** KJC-TSK-1324: `kj code --card <id> "<title>"` in the lane, output inherited (the board's log). */
const runCoderIn = ({ cwd, card, task }) =>
  spawnSync(process.execPath, [KJ_BIN, "code", "--card", card, task], { cwd, stdio: "inherit" }).status ?? 1;

/** A lane slug from a card's title: ascii, lowercase, dashes; "task" when nothing is left. */
export function slugOf(title) {
  const slug = String(title ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, SLUG_MAX).replace(/-+$/, "");
  return slug || "task";
}

/** The lanes under the main checkout's `.kj/worktrees`, read from git (nothing printed). */
function mainLanes(projectDir) {
  const out = spawnSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8", cwd: projectDir });
  if (out.status !== 0) throw new Error(`git worktree list failed: ${out.stderr}`);
  const main = out.stdout.split("\n").find((l) => l.startsWith("worktree "))?.slice(9).trim();
  return parseLanes(out.stdout, { root: path.join(main, ".kj", "worktrees") });
}

/** The one lane the card already has (by id or by an `external_ref` part), null when none; throws when several. */
async function existingLane({ ref, card, lanes, projectDir }) {
  const refs = String(card.external_ref ?? "").split(REF_SEPARATOR).map((r) => r.trim()).filter(Boolean);
  const found = [...lanesByCard(await lanes(projectDir),[ref, ...refs]).values()].flat();
  const unique = [...new Map(found.map((l) => [l.path, l])).values()];
  if (unique.length > 1) {
    throw new Error(`${ref} already has ${unique.length} lanes (${unique.map((l) => l.path).join(", ")}): keep one and remove the others with kj worktree done <slug>`);
  }
  return unique[0] ?? null;
}

/**
 * @param {{ config: object, args: string[], deps: { findCard: Function, worktree?: Function, lanes?: Function },
 *   move: () => Promise<unknown>, who: string|null, emit: Function }} opts
 */
export async function startAction({ config, args, flags = {}, deps, move, who, emit }) {
  const [ref, slugArg] = args;
  if (!ref) throw new Error("usage: kj hu start <id> [slug]");
  const card = await deps.findCard(ref);
  if (!card) throw new Error(`${ref} not found — see kj hu list`);
  if (card.claimed_by && card.claimed_by !== who) {
    throw new Error(`${ref} is held by ${card.claimed_by}: ask them, or take it explicitly with kj hu move ${ref} running --release`);
  }
  const existing = await existingLane({ ref, card, lanes: deps.lanes ?? mainLanes, projectDir: config?.projectDir });
  const lane = existing ?? await (deps.worktree ?? worktreeCommand)({ config, action: "start", args: [`${ref}-${slugArg || slugOf(card.title)}`], flags: {} });
  try {
    await move();
  } catch (err) {
    throw new Error(`lane ${lane.branch} is ready but ${ref} is not running yet (${err.message}): kj hu move ${ref} running`, { cause: err });
  }
  // KJC-TSK-1324: the board's ▶ has the panel coder write the card in its lane; review and commit stay with you.
  if (flags.code) {
    const status = (deps.runCoder ?? runCoderIn)({ cwd: lane.path, card: ref, task: card.title });
    if (status !== 0) throw new Error(`the coder (kj code --card ${ref}) ended with exit ${status} in ${lane.path}`);
  }
  const { skills, section } = await hostSkillsFor({ card, lane, deps });
  const extra = skills.length ? { skills } : {};
  const tail = section ? `\n${section}` : "";
  if (existing) return emit({ id: ref, branch: lane.branch, lane: lane.path, reused: true, ...extra }, `✓ ${ref} started in its existing lane ${lane.branch}\n  cd ${lane.path}${tail}`);
  return emit({ id: ref, branch: lane.branch, lane: lane.path, ...extra }, `✓ ${ref} started in its lane ${lane.branch}\n  cd ${lane.path}${tail}`);
}

/**
 * HU-4222: the atril skills of the card for the host agent, noted on the lane's activity for kj stage.
 * The lane and the move already happened, so a failure here is a warning line, never an undone start:
 * this is the one place where the start stays usable on purpose.
 */
async function hostSkillsFor({ card, lane, deps }) {
  const none = { skills: [], section: "" };
  const host = (deps.detectHost ?? detectHostAgent)();
  if (!host) return none;
  try {
    const result = await (deps.hostSkills ?? roleSkills)({ role: "host", task: card.title, projectDir: lane.path });
    const skills = result.skills.map((s) => s.name);
    if (!skills.length) return none;
    note(lane.path, { agent: host, role: "host", phase: "start", skills });
    return { skills, section: buildRoleSkillSection(result, { provider: host }) };
  } catch (err) {
    console.warn(`! skills for the host not resolved: ${err.message}`);
    return none;
  }
}

/**
 * `kj hu start <id> [slug]` (KJC-TSK-1372, #2853, step 7 of #2566): starting a task is one
 * step, in the order that works. In 5.0 the host agent does the work inside a lane, so a lane
 * that comes before its card gets its writes refused later. This command:
 * 1. finds the card and refuses, before creating anything, if it does not exist or someone else holds it;
 * 2. opens its lane with `kj worktree start <id>-<slug>` (feat/<id>-<slug> from origin/<base>, set up);
 * 3. moves the card to running, which claims it, and prints the cd.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { worktreeCommand } from "./worktree.js";

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

/**
 * @param {{ config: object, args: string[], deps: { findCard: Function, worktree?: Function },
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
  const lane = await (deps.worktree ?? worktreeCommand)({ config, action: "start", args: [`${ref}-${slugArg || slugOf(card.title)}`], flags: {} });
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
  return emit({ id: ref, branch: lane.branch, lane: lane.path }, `✓ ${ref} started in its lane ${lane.branch}\n  cd ${lane.path}`);
}

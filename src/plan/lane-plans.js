/**
 * #2566: a lane (<main>/.kj/worktrees/<x>, <main>/.claude/worktrees/<x>) kept plans under its own
 * slug; `kj hu list` moves them to the main checkout's. A taken name is kept and reported.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { plansDir } from "./plan-store.js";
import { mainCheckout } from "../utils/main-checkout.js";
import { MIRROR_PLAN_ID } from "../hu/team-board-mirror.js";

const LANE_DIRS = [".kj_worktrees_", ".claude_worktrees_"];

// Never overwrites: "wx" and errorOnExist fail with EEXIST if another session wrote dest first.
async function moveEntry(from, dest, main) {
  const plan = from.endsWith(".json") ? await fs.readFile(from, "utf8").then(JSON.parse, () => null) : null;
  if (plan) {
    // TSK-0341: the stamp must outlive the lane, or the GC sees the plan as orphan.
    await fs.writeFile(dest, JSON.stringify({ ...plan, projectDir: main }, null, 2), { flag: "wx" });
    return fs.unlink(from);
  }
  await fs.cp(from, dest, { recursive: true, force: false, errorOnExist: true });
  return fs.rm(from, { recursive: true });
}

export async function migrateLanePlans(projectDir) {
  const [target, main] = [plansDir(projectDir), mainCheckout(projectDir)];
  const root = path.dirname(target);
  const prefixes = LANE_DIRS.map((d) => `${path.basename(target)}_${d}`); // the main checkout's slug
  const moved = [];
  const kept = [];
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (err) {
    if (err.code === "ENOENT") return { moved, kept };
    throw err;
  }
  const isLaneFolder = (e) => e.isDirectory() && prefixes.some((p) => e.name.startsWith(p));
  for (const lane of entries.filter(isLaneFolder)) {
    const from = path.join(root, lane.name);
    await fs.mkdir(target, { recursive: true });
    for (const file of await fs.readdir(from)) {
      // The team board mirror is no plan: `kj hu list` rewrites it from GitHub, a lane's copy is stale.
      if (file === `${MIRROR_PLAN_ID}.json`) { await fs.unlink(path.join(from, file)); continue; }
      try {
        await moveEntry(path.join(from, file), path.join(target, file), main);
        moved.push(file);
      } catch (err) {
        if (err.code !== "EEXIST" && err.code !== "ERR_FS_CP_EEXIST") throw err;
        kept.push(path.join(from, file));
      }
    }
    await fs.rmdir(from).catch((err) => { if (err.code !== "ENOTEMPTY") throw err; }); // a collision stays
  }
  return { moved, kept };
}

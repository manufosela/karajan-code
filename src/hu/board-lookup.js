/**
 * KJC-BUG-0454: one card of the HU Board, read where `kj hu` keeps it. `kj code --card`
 * looked in the old kj run store, so every card `kj hu add` created was "not found".
 * Shared board: the GitHub issue HU-<n>, as `kj hu list` reads it. Local board: the
 * plan backlog, by id or short id.
 */
import { listPlans, loadPlan } from "../plan/plan-store.js";
import { readBoardConfig } from "./board-config.js";
import { listHus } from "./github-board.js";
import { pinGhIdentity } from "./gh-identity.js";
import { listWithCache } from "./team-board-cache.js";

const SHARED_ID = /^HU-[1-9]\d*$/i;

export async function findBoardHu(projectDir, ref, deps = {}) {
  const board = await (deps.boardConfig ?? readBoardConfig)(projectDir);
  if (board.backend === "github" && SHARED_ID.test(ref)) {
    (deps.pinGhIdentity ?? pinGhIdentity)({ projectDir });
    const { rows } = await (deps.cache?.list ?? listWithCache)({ projectDir, repo: board.repo, list: deps.listTeamHus ?? listHus });
    const hu = rows.find((h) => h.short_id.toUpperCase() === ref.toUpperCase());
    if (hu) return hu;
  }
  for (const meta of await (deps.listPlans ?? listPlans)(projectDir)) {
    const plan = await (deps.loadPlan ?? loadPlan)(projectDir, meta.planId);
    const hu = (plan.hus || []).find((h) => h.id === ref || h.short_id === ref);
    if (hu) return hu;
  }
  throw new Error(`HU ${ref} is not on the HU Board — kj hu list shows its cards`);
}

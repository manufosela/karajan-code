/**
 * Proposed work (STW-D, KJC-TSK-0792, epic KJC-PCS-0081) — every broken
 * invariant becomes a CARD in the channel the Brain already consumes, as a
 * PROPOSAL: evidence, since-when, and a remedy plan that nothing executes
 * without review (the user's decision, 22-aug: an unreviewed generated plan
 * can do more harm than the decay itself). The same break UPDATES its card —
 * a daily sweep must never flood the board with twins — and a green
 * invariant resolves it with the green evidence.
 *
 * kj only writes the board it owns (hu-board). planning-game and external
 * boards are never mirrored (KJC-TSK-0684: a half-empty parallel board is
 * worse than none): there the sweep reports synced:false LOUDLY, and the
 * Sentinel's inevitable notice (STW-C) pushes the host agent — who does
 * have the board's MCP — to card them.
 */
import fs from "node:fs";
import path from "node:path";
import { addHu, updateHu, updateHuStatus } from "../plan/plan-hu-ops.js";
import { savePlan } from "../plan/plan-store.js";
import { backlogPlan } from "../commands/hu.js";

const mapPath = (projectDir) => path.join(projectDir, ".karajan", "steward", "cards.json");
const readMap = (projectDir) => { try { return JSON.parse(fs.readFileSync(mapPath(projectDir), "utf8")); } catch { return {}; } };

const cardText = (r, brokenSince) => [
  `Steward invariant BROKEN since ${brokenSince}.`,
  `Evidence: ${r.evidence || "(none recorded)"}`,
  `Proposed remedy plan: ${r.remedy || r.renew || "kj steward sweep"}.`,
  "This plan is a PROPOSAL — review before executing: nothing in it runs unreviewed.",
].join("\n");

/**
 * @returns {Promise<{synced: boolean, reason?: string, created?: number, updated?: number, resolved?: number}>}
 */
export async function syncProposedWork({ projectDir, config = {}, results = [], sweptAt }) {
  const backend = config.state_backend || "hu-board";
  if (backend !== "hu-board") {
    return { synced: false, reason: `the board lives in ${backend} — kj never mirrors a board it does not own; card the broken invariants through your agent's board tools` };
  }
  const map = readMap(projectDir);
  const broken = results.filter((r) => r.verdict === "broken");
  const okAgain = results.filter((r) => r.verdict === "ok" && map[r.id]);
  if (broken.length === 0 && okAgain.length === 0) return { synced: true, created: 0, updated: 0, resolved: 0 };

  const plan = await backlogPlan(projectDir);
  let created = 0, updated = 0, resolved = 0;
  for (const r of broken) {
    const known = map[r.id];
    if (known) {
      updateHu(plan, known.huId, { scope: cardText(r, known.brokenSince) });
      updated += 1;
    } else {
      const hu = addHu(plan, { title: `steward: ${r.id} broken — proposed remedy (review before executing)`, scope: cardText(r, sweptAt), created_by: "steward" });
      map[r.id] = { huId: hu.id, brokenSince: sweptAt };
      created += 1;
    }
  }
  for (const r of okAgain) {
    updateHu(plan, map[r.id].huId, { scope: `Resolved: the invariant is green again (${r.evidence || "no evidence text"}) — validation stays with the user.` });
    updateHuStatus(plan, map[r.id].huId, "done");
    delete map[r.id];
    resolved += 1;
  }
  await savePlan(projectDir, plan);
  fs.mkdirSync(path.dirname(mapPath(projectDir)), { recursive: true });
  fs.writeFileSync(mapPath(projectDir), `${JSON.stringify(map, null, 2)}\n`);
  return { synced: true, created, updated, resolved };
}

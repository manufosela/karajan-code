/**
 * Proposed work (STW-D, KJC-TSK-0792, epic KJC-PCS-0081) — every broken
 * invariant becomes a CARD in the channel the Brain already consumes, as a
 * PROPOSAL: evidence, since-when, and a remedy plan that nothing executes
 * without review (the user's decision, 22-aug: an unreviewed generated plan
 * can do more harm than the decay itself). The same break UPDATES its card —
 * a daily sweep must never flood the board with twins — and a green
 * invariant resolves it with the green evidence.
 *
 * KJC-BUG-0305: the HU Board is always kj's board, so the cards land there on
 * every backend. With planning-game or an external board the result names it
 * (replicateIn): the host agent, who has that board's MCP, replicates them.
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

// HU-3841: a not-observable invariant opens a card only when it PERSISTS.
export const NOT_OBSERVABLE_MIN_SWEEPS = 3;
export const NOT_OBSERVABLE_MAX_DAYS = 7;
const DAY_MS = 86_400_000;

const instrumentText = (r, state) => [
  `Steward invariant NOT OBSERVABLE since ${state.since} (${state.sweeps} consecutive sweeps).`,
  `Evidence: ${r.evidence || "(none recorded)"}`,
  `Proposed remedy plan: instrument it — ${r.remedy || r.renew || "give the invariant something to observe"}.`,
  "This plan is a PROPOSAL — review before executing: nothing in it runs unreviewed.",
].join("\n");

const persists = (state, sweptAt) => state.sweeps >= NOT_OBSERVABLE_MIN_SWEEPS
  || Date.parse(sweptAt) - Date.parse(state.since) > NOT_OBSERVABLE_MAX_DAYS * DAY_MS;

/** Streaks per id: grow on not-observable, vanish on any other verdict. */
function advanceStreaks(prev, results, sweptAt) {
  const next = { ...prev };
  for (const r of results) {
    if (r.verdict !== "not-observable") { delete next[r.id]; continue; }
    const old = prev[r.id];
    next[r.id] = { ...old, since: old?.since ?? sweptAt, sweeps: (old?.sweeps ?? 0) + 1 };
  }
  return next;
}

function syncInstrumentCards(plan, map, results, sweptAt) {
  const prev = map.notObservable ?? {};
  const next = advanceStreaks(prev, results, sweptAt);
  let created = 0, updated = 0, resolved = 0;
  for (const r of results.filter((x) => x.verdict === "not-observable" && persists(next[x.id], sweptAt))) {
    const state = next[r.id];
    if (state.huId) {
      updateHu(plan, state.huId, { scope: instrumentText(r, state) });
      updated += 1;
    } else {
      const hu = addHu(plan, { title: `steward: ${r.id} not observable — instrument it (review before executing)`, scope: instrumentText(r, state), created_by: "steward" });
      state.huId = hu.id;
      created += 1;
    }
  }
  for (const [id, old] of Object.entries(prev)) {
    if (next[id] || !old.huId) continue;
    const r = results.find((x) => x.id === id);
    updateHu(plan, old.huId, { scope: `Resolved: the invariant is observable again (${r.evidence || "no evidence text"}) — validation stays with the user.` });
    updateHuStatus(plan, old.huId, "done");
    resolved += 1;
  }
  if (Object.keys(next).length > 0) map.notObservable = next; else delete map.notObservable;
  return { created, updated, resolved };
}

/**
 * @returns {Promise<{synced: boolean, reason?: string, created?: number, updated?: number, resolved?: number, instrument?: number}>}
 */
export async function syncProposedWork({ projectDir, config = {}, results = [], sweptAt }) {
  const backend = config.state_backend || "hu-board";
  const replica = backend === "hu-board" ? {} : { replicateIn: backend };
  const map = readMap(projectDir);
  const broken = results.filter((r) => r.verdict === "broken");
  const okAgain = results.filter((r) => r.verdict === "ok" && map[r.id]);
  const streaks = results.some((r) => r.verdict === "not-observable") || Object.keys(map.notObservable ?? {}).length > 0;
  if (broken.length === 0 && okAgain.length === 0 && !streaks) return { synced: true, created: 0, updated: 0, resolved: 0, instrument: 0, ...replica };

  const plan = await backlogPlan(projectDir);
  const inst = syncInstrumentCards(plan, map, results, sweptAt);
  let created = 0, updated = 0, resolved = inst.resolved;
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
  return { synced: true, created, updated, resolved, instrument: inst.created + inst.updated, ...replica };
}

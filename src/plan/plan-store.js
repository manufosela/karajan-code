/**
 * Plan persistence — save, load, list, update, delete plans.
 * Plans are stored at ~/.kj/plans/<projectSlug>/<planId>.json
 * Supports v1 (text-only) and v2 (plans + HUs) schemas.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "../utils/atomic-write.js";
import { resolveHome } from "../utils/paths.js";
import { generatePlanId, normaliseAlias } from "./plan-id.js";

/**
 * A plan JSON file failed to parse — typically an interrupted write
 * leaves it truncated. Previously every read site swallowed this with
 * a silent catch and the plan vanished from `kj plan list` and
 * `kj plan load` as if it had never existed.
 *
 * Now: warn loudly so the user knows their plan is corrupt, and rename
 * the file to `<name>.corrupt-<ts>` so it stops blocking subsequent
 * reads of the same alias / planId (without destroying evidence).
 * Best-effort: if the rename itself fails (read-only FS, permissions),
 * we log and move on — never escalate to a throw, that would block the
 * caller from reading the rest of the directory.
 */
async function handleCorruptPlanFile(filePath, error) {
  const corruptPath = `${filePath}.corrupt-${Date.now()}`;
  // eslint-disable-next-line no-console
  console.warn(`[plan-store] Corrupt plan JSON at ${filePath}: ${error.message}`);
  try {
    await fs.rename(filePath, corruptPath);
    // eslint-disable-next-line no-console
    console.warn(`[plan-store] Renamed to ${path.basename(corruptPath)} so it stops blocking subsequent reads.`);
  } catch (renameErr) {
    // eslint-disable-next-line no-console
    console.warn(`[plan-store] Could not rename ${filePath}: ${renameErr.message}`);
  }
}
import { isPlanV2, migratePlanV1toV2 } from "./plan-schema.js";

// Delegates to the unified resolver in src/utils/paths.js. The
// `defaultSegment: ".kj"` preserves the legacy default until PR 3
// flips every caller to `.karajan/` simultaneously. The vitest
// isolation, KARAJAN_HOME precedence and KJ_HOME deprecation
// warning all live in the resolver — nothing else needs to know.
export function getKjHome() {
  return resolveHome({ defaultSegment: ".kj" });
}

/**
 * Deterministic slug for a project path — stable across plan-store writes,
 * HU-board syncs and board URL routing. Keep in lockstep with
 * `packages/hu-board/src/sync.js::deriveProjectIdFromDir`.
 * @param {string} projectDir - absolute project path
 * @returns {string}
 */
export function projectSlug(projectDir) {
  return projectDir
    .replace(/^\//, "")
    .replace(/[/\\]/g, "_")
    .replaceAll(/[^a-zA-Z0-9_.-]/g, "")
    .slice(0, 120);
}

export function plansDir(projectDir) {
  return path.join(getKjHome(), "plans", projectSlug(projectDir));
}

/**
 * Save a plan to disk. Accepts both v1 and v2 schemas.
 * @param {string} projectDir
 * @param {object} planResult - v1 { task, plan, raw } or v2 { planId, version, hus, ... }
 * @returns {Promise<string>} planId
 */
export async function savePlan(projectDir, planResult) {
  const dir = plansDir(projectDir);
  await fs.mkdir(dir, { recursive: true });

  // v2 plans already have planId and full schema
  if (isPlanV2(planResult)) {
    const filePath = path.join(dir, `${planResult.planId}.json`);
    planResult.updatedAt = new Date().toISOString();
    // TSK-0341 / garbage-collector: stamp the absolute projectDir on every
    // plan so the GC can check `fs.exists(projectDir)` reliably. Reverse-
    // engineering it from the slug is lossy (underscores in the original
    // name collide with underscores introduced by slash-substitution).
    if (!planResult.projectDir && projectDir) planResult.projectDir = projectDir;
    // Humanización IDs: si el plan no tiene alias todavía, derívalo de
    // plan.name (lo que el planner pidió al usuario). Resuelve
    // colisiones con sufijo -2, -3… leyendo el dir antes.
    if (!planResult.alias && planResult.name) {
      planResult.alias = await resolveUniqueAlias(dir, planResult.planId, normaliseAlias(planResult.name));
    }
    await writeJsonAtomic(filePath, planResult);
    return planResult.planId;
  }

  // v1: generate planId and wrap
  const planId = planResult.planId || generatePlanId();
  const record = {
    planId,
    task: planResult.task || null,
    researchContext: planResult.researchContext || null,
    architectContext: planResult.architectContext || null,
    plan: planResult.plan || null,
    raw: planResult.raw || null,
    createdAt: new Date().toISOString()
  };

  const filePath = path.join(dir, `${planId}.json`);
  await writeJsonAtomic(filePath, record);
  return planId;
}

/**
 * Resuelve un alias único en `dir`. Si `base` ya está en uso por otro
 * plan, intenta `base-2`, `base-3`… hasta encontrar libre.
 * @param {string} dir
 * @param {string} ownPlanId - planId del plan que se está guardando (su propio archivo se ignora en el lookup).
 * @param {string|null} base
 * @returns {Promise<string|null>}
 */
async function resolveUniqueAlias(dir, ownPlanId, base) {
  if (!base) return null;
  let files;
  try { files = await fs.readdir(dir); } catch { return base; }
  const taken = new Set();
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const filePath = path.join(dir, f);
    try {
      const record = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (record.planId === ownPlanId) continue;
      if (record.alias) taken.add(record.alias);
    } catch (err) {
      if (err.code !== "ENOENT") await handleCorruptPlanFile(filePath, err);
    }
  }
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${ownPlanId.slice(-4)}`;  // fallback improbable
}

/**
 * Load a plan by ID or alias. Auto-migrates v1 to v2 on read (lazy).
 * Acepta tanto el planId canónico (plan-XXX-XX) como el alias humano
 * (greta-app). Primero busca por filename exacto (planId.json), luego
 * escanea el dir y matchea por alias.
 *
 * @returns {Promise<object|null>} v2 plan o null
 */
export async function loadPlan(projectDir, ref) {
  if (!ref) return null;
  const dir = plansDir(projectDir);
  // 1. Match exacto por planId.json (camino caliente).
  const direct = path.join(dir, `${ref}.json`);
  try {
    const data = await fs.readFile(direct, "utf8");
    const plan = JSON.parse(data);
    if (!isPlanV2(plan)) return migratePlanV1toV2(plan);
    return plan;
  } catch (err) {
    // ENOENT is expected (caller may have passed an alias, not a planId)
    // → fall through to the alias scan. Anything else means the file is
    // there but unreadable / corrupt; surface it instead of silently
    // hiding the plan.
    if (err.code !== "ENOENT") await handleCorruptPlanFile(direct, err);
  }
  // 2. Escaneo del dir por alias. Coste O(N) pero N suele ser <10.
  let files;
  try { files = await fs.readdir(dir); } catch { return null; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const filePath = path.join(dir, f);
    try {
      const record = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (record.alias === ref || record.planId === ref) {
        if (!isPlanV2(record)) return migratePlanV1toV2(record);
        return record;
      }
    } catch (err) {
      if (err.code !== "ENOENT") await handleCorruptPlanFile(filePath, err);
    }
  }
  return null;
}

/**
 * Delete a plan from disk.
 * @returns {Promise<boolean>}
 */
export async function deletePlan(projectDir, planId) {
  const filePath = path.join(plansDir(projectDir), `${planId}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all plans for a project, sorted newest first.
 */
export async function listPlans(projectDir) {
  const dir = plansDir(projectDir);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const plans = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    if (file.includes(".corrupt-")) continue; // own renamed-aside files
    const filePath = path.join(dir, file);
    try {
      const data = await fs.readFile(filePath, "utf8");
      const record = JSON.parse(data);
      plans.push({
        planId: record.planId,
        alias: record.alias || null,
        task: record.task,
        name: record.name || null,
        status: record.status || "draft",
        version: record.version || 1,
        huCount: Array.isArray(record.hus) ? record.hus.length : 0,
        createdAt: record.createdAt
      });
    } catch (err) {
      if (err.code !== "ENOENT") await handleCorruptPlanFile(filePath, err);
    }
  }

  plans.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return plans;
}

/**
 * Get the most recent plan.
 */
export async function getLatestPlan(projectDir) {
  const all = await listPlans(projectDir);
  if (all.length === 0) return null;
  return loadPlan(projectDir, all[0].planId);
}

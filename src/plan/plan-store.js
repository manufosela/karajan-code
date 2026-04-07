/**
 * Plan persistence — save, load, list, update, delete plans.
 * Plans are stored at ~/.kj/plans/<projectSlug>/<planId>.json
 * Supports v1 (text-only) and v2 (plans + HUs) schemas.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generatePlanId } from "./plan-id.js";
import { isPlanV2, migratePlanV1toV2 } from "./plan-schema.js";

function getKjHome() {
  return process.env.KJ_HOME || path.join(os.homedir(), ".kj");
}

function projectSlug(projectDir) {
  return projectDir
    .replace(/^\//, "")
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "")
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
    await fs.writeFile(filePath, JSON.stringify(planResult, null, 2), "utf8");
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
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
  return planId;
}

/**
 * Load a plan by ID. Auto-migrates v1 to v2 on read (lazy).
 * @returns {Promise<object|null>} v2 plan or null
 */
export async function loadPlan(projectDir, planId) {
  const filePath = path.join(plansDir(projectDir), `${planId}.json`);
  try {
    const data = await fs.readFile(filePath, "utf8");
    const plan = JSON.parse(data);
    if (!isPlanV2(plan)) return migratePlanV1toV2(plan);
    return plan;
  } catch {
    return null;
  }
}

/**
 * Update a plan on disk (partial merge).
 * @returns {Promise<boolean>}
 */
export async function updatePlan(projectDir, planId, patch) {
  const plan = await loadPlan(projectDir, planId);
  if (!plan) return false;
  Object.assign(plan, patch);
  plan.updatedAt = new Date().toISOString();
  const filePath = path.join(plansDir(projectDir), `${planId}.json`);
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2), "utf8");
  return true;
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
    try {
      const data = await fs.readFile(path.join(dir, file), "utf8");
      const record = JSON.parse(data);
      plans.push({
        planId: record.planId,
        task: record.task,
        name: record.name || null,
        status: record.status || "draft",
        version: record.version || 1,
        huCount: Array.isArray(record.hus) ? record.hus.length : 0,
        createdAt: record.createdAt
      });
    } catch { /* skip corrupt */ }
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

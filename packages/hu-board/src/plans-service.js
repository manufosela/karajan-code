// KJC-TSK-0541: reading the plan JSONs, shared by the API routers and testable without Express.
// Every scan covers the canonical and the legacy plans roots (KJC-BUG-0059).
import fsp from 'node:fs/promises';
import path from 'node:path';

import { getHuBoardPlansDirs } from './db.js';

/** Async existence probe (KJC-TSK-0539: no sync fs in handlers). */
export const pathExists = (p) => fsp.access(p).then(() => true, () => false);

/**
 * mtime-keyed cache for parsed plan JSON (KJC-TSK-0539). The plan scans
 * used to re-read and re-parse every plan file on EVERY request; with N
 * plans and the board polling, that was O(N) parses per poll. The cache
 * serves the parsed object while the file's mtime is unchanged and
 * re-reads transparently when kj writes the plan.
 */
const planFileCache = new Map();
export async function readPlanCached(p) {
  const { mtimeMs } = await fsp.stat(p);
  const hit = planFileCache.get(p);
  if (hit && hit.mtimeMs === mtimeMs) return hit.plan;
  const plan = JSON.parse(await fsp.readFile(p, 'utf8'));
  planFileCache.set(p, { mtimeMs, plan });
  return plan;
}

/** Every readable plan JSON of a project; an unreadable file is skipped. */
export async function* projectPlans(projectId) {
  for (const root of getHuBoardPlansDirs()) {
    const plansDir = path.join(root, projectId);
    if (!(await pathExists(plansDir))) continue;
    for (const f of (await fsp.readdir(plansDir)).filter((n) => n.endsWith('.json'))) {
      let plan;
      try {
        plan = await readPlanCached(path.join(plansDir, f));
      } catch {
        continue;
      }
      yield plan;
    }
  }
}

/** The path of `plan-<planId>.json` under any project of any plans root, or null. */
export async function findPlanFile(planId) {
  for (const plansRoot of getHuBoardPlansDirs()) {
    if (!(await pathExists(plansRoot))) continue;
    for (const projSlug of await fsp.readdir(plansRoot)) {
      const candidate = path.join(plansRoot, projSlug, `plan-${planId}.json`);
      if (await pathExists(candidate)) return candidate;
    }
  }
  return null;
}

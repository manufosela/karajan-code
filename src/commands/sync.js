/**
 * `kj sync` — closed-loop drift detection between code and Canvas/plan.
 * Issue #540 MVP: detection + report only. No --apply yet.
 */

import fs from "node:fs";
import path from "node:path";
import { listPlans, loadPlan } from "../plan/plan-store.js";
import { classifyDrift, formatDriftReport } from "../sync/detect-drift.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".karajan", ".kj", "tmp", ".cache", ".astro", ".next"]);

function listSourceFiles(rootDir, out = []) {
  for (const e of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && !["src", "tests"].includes(e.name)) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(rootDir, e.name);
    if (e.isDirectory()) {
      listSourceFiles(p, out);
    } else if (e.isFile()) {
      try {
        const s = fs.statSync(p);
        out.push({
          path: path.relative(rootDir, p),
          mtime: s.mtime,
        });
      } catch { /* ignore stat errors */ }
    }
  }
  return out;
}

/**
 * @param {object} args
 * @param {object} args.config
 * @param {object} args.logger
 * @param {string} [args.planId] — when set, sync against this plan; else use the latest
 * @param {boolean} [args.json]
 */
export async function syncCommand({ config, logger, planId, json }) {
  const projectDir = config?.projectDir || process.cwd();

  // Resolve which plan to sync against.
  let plan;
  if (planId) {
    plan = await loadPlan(projectDir, planId);
    if (!plan) throw new Error(`kj sync: plan not found: ${planId}`);
  } else {
    const all = await listPlans(projectDir);
    if (!all || all.length === 0) {
      throw new Error("kj sync: no plans found for this project. Generate one with `kj plan generate --task-file SPEC.md` (or `--canvas SPEC.canvas.md` for the structured form).");
    }
    // Pick the most recent plan by createdAt.
    plan = await loadPlan(projectDir, all.sort((a, b) =>
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0].planId);
  }

  logger.info(`kj sync: comparing ${projectDir} against plan ${plan.planId}`);

  const files = listSourceFiles(projectDir);
  const report = classifyDrift(plan, files);

  if (json) {
    console.log(JSON.stringify({
      planId: plan.planId,
      projectDir,
      ...report,
    }, null, 2));
  } else {
    console.log(formatDriftReport(report, plan));
  }

  // Exit 0 always — drift is informational, not an error. CI users
  // can opt-in to "exit non-zero on drift" later via a flag.
}

/**
 * `kj sync` — closed-loop drift detection between code and Canvas/plan.
 * Issue #540 MVP: detection + report.
 * KJC-TSK-0348: `--apply` writes drift notes back into the source Canvas
 * markdown (with `.bak` backup) so the user can review + commit.
 */

import fs from "node:fs";
import path from "node:path";
import { listPlans, loadPlan } from "../plan/plan-store.js";
import { classifyDrift, formatDriftReport } from "../sync/detect-drift.js";
import { applyCanvasPatch } from "../sync/apply-canvas-patch.js";

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
 * @param {boolean} [args.apply] — when true, write a drift patch back into
 *                                 the Canvas markdown the plan came from
 *                                 (with `.bak` backup).
 */
export async function syncCommand({ config, logger, planId, json, apply }) {
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

  let applyResult = null;
  if (apply) {
    if (!plan.sourceCanvasPath) {
      throw new Error(
        "kj sync --apply: this plan has no sourceCanvasPath — it was not generated from a SPEC.canvas.md. "
        + "Re-run `kj plan generate --task-file SPEC.canvas.md` so the plan remembers the Canvas it came from."
      );
    }
    applyResult = await applyCanvasPatch({ canvasPath: plan.sourceCanvasPath, report });
  }

  if (json) {
    console.log(JSON.stringify({
      planId: plan.planId,
      projectDir,
      ...report,
      apply: applyResult,
    }, null, 2));
  } else {
    console.log(formatDriftReport(report, plan));
    if (applyResult) {
      if (applyResult.skipped) {
        console.log("\nkj sync --apply: no actionable drift, Canvas left untouched.");
      } else {
        console.log(
          `\nkj sync --apply: wrote ${applyResult.mutations} drift note(s) to ${applyResult.patchedPath} `
          + `(backup at ${applyResult.backupPath}).`
        );
      }
    }
  }

  // Exit 0 always — drift is informational, not an error. CI users
  // can opt-in to "exit non-zero on drift" later via a flag.
}

/**
 * Sovereignty guard for MCP inputs.
 *
 * Validates kj_run parameters and rejects host-AI attempts to override
 * pipeline decisions that Karajan makes internally (triage, hu-reviewer, etc.).
 */

import fs from "node:fs";
import path from "node:path";

/** Parameters that the host AI is allowed to pass through without restriction. */
const ALLOWED_PARAMS = new Set([
  "task", "projectDir", "pgTask", "pgProject",
  "planner", "coder", "reviewer", "refactorer",
  "plannerModel", "coderModel", "reviewerModel", "refactorerModel",
  "enablePlanner", "enableReviewer", "enableRefactorer", "enableResearcher",
  "enableTester", "enableSecurity", "enableImpeccable",
  "enableDiscover", "enableArchitect",
  "architectModel", "huFile",
  "enableSerena", "enableCi",
  "reviewerFallback", "reviewerRetries",
  "mode", "maxIterations", "maxIterationMinutes", "maxTotalMinutes",
  "baseBranch", "baseRef", "methodology",
  "autoCommit", "autoPush", "autoPr", "autoRebase", "branchPrefix",
  "autoSimplify", "smartModels", "checkpointInterval",
  "taskType", "quiet", "noSonar", "enableSonarcloud",
  "kjHome", "sonarToken", "timeoutMs", "domain",
  // Sovereign flags — validated below but still "known"
  "enableTriage", "enableHuReviewer",
]);

const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 10;
const ACTIVE_SESSION_THRESHOLD_MS = 60_000;

/**
 * Check if a pipeline is already running for this project.
 * Looks at .kj/run.log modification time.
 *
 * @param {string} projectDir - Project root directory
 * @returns {{ active: boolean, message?: string }}
 */
export function checkActiveSession(projectDir) {
  if (!projectDir) return { active: false };
  const logPath = path.join(projectDir, ".kj", "run.log");
  try {
    const stat = fs.statSync(logPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < ACTIVE_SESSION_THRESHOLD_MS) {
      return {
        active: true,
        message:
          "A pipeline is already running for this project. " +
          "Wait for it to complete or use kj_status to check progress.",
      };
    }
  } catch {
    // File doesn't exist or can't be read — no active session
  }
  return { active: false };
}

/**
 * Validate and sanitise kj_run parameters.
 *
 * @param {Record<string, unknown>} params - Raw parameters from the MCP call
 * @param {{ projectDir?: string }} context - Runtime context
 * @returns {{ params: Record<string, unknown>, warnings: string[], error?: string }}
 */
export function validateSovereignty(params, context = {}) {
  const warnings = [];
  const sanitized = { ...params };

  // 1. Strip unknown parameters
  for (const key of Object.keys(sanitized)) {
    if (!ALLOWED_PARAMS.has(key)) {
      warnings.push(`Unknown parameter "${key}" stripped`);
      delete sanitized[key];
    }
  }

  // 2. Sovereign flags — pipeline decides, not the host AI
  if (sanitized.enableHuReviewer === false) {
    warnings.push("Pipeline decides hu-reviewer activation, ignoring override");
    delete sanitized.enableHuReviewer;
  }

  if (sanitized.enableTriage === false) {
    warnings.push("Triage is mandatory, ignoring override");
    delete sanitized.enableTriage;
  }

  // 3. Clamp maxIterations to [1, 10]
  if (sanitized.maxIterations !== undefined) {
    const n = Number(sanitized.maxIterations);
    if (!Number.isFinite(n) || n < MIN_ITERATIONS) {
      warnings.push(`maxIterations ${sanitized.maxIterations} clamped to ${MIN_ITERATIONS}`);
      sanitized.maxIterations = MIN_ITERATIONS;
    } else if (n > MAX_ITERATIONS) {
      warnings.push(`maxIterations ${sanitized.maxIterations} clamped to ${MAX_ITERATIONS}`);
      sanitized.maxIterations = MAX_ITERATIONS;
    }
  }

  // 4. Active session detection
  const session = checkActiveSession(context.projectDir);
  if (session.active) {
    return { params: sanitized, warnings, error: session.message };
  }

  return { params: sanitized, warnings };
}

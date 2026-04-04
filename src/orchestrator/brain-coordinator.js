// Brain Coordinator: integrates Karajan Brain + 5 support modules into the pipeline.
// Replaces ad-hoc role-to-role communication with a central intelligence.

import * as queue from "./feedback-queue.js";
import * as enrich from "./feedback-enrichment.js";
import { verifyCoderOutput, VerificationTracker } from "./verification-gate.js";
import { executeActions } from "./direct-actions.js";
import { compressRoleOutput, measureCompression } from "./role-output-compressor.js";

/**
 * @typedef {Object} BrainContext
 * @property {Object} feedbackQueue - structured feedback queue
 * @property {VerificationTracker} verificationTracker - tracks coder changes
 * @property {Object} compressionStats - token savings per role
 * @property {boolean} enabled - whether brain coordination is active
 */

/**
 * Create a new brain context for a pipeline session.
 */
export function createBrainContext({ enabled = false } = {}) {
  return {
    feedbackQueue: queue.createQueue(),
    verificationTracker: new VerificationTracker(),
    compressionStats: { totalSaved: 0, perRole: {} },
    enabled
  };
}

/**
 * Check if brain coordination is enabled for this config.
 */
export function isBrainEnabled(config) {
  return Boolean(config?.brain?.enabled) || Boolean(config?.pipeline?.brain?.enabled);
}

/**
 * After a role completes, push its feedback to the queue and compress.
 * Returns the compressed output for passing to next role.
 */
export function processRoleOutput(ctx, { roleName, output, iteration }) {
  if (!ctx.enabled) return output;

  // Compress for next-role context
  const compressed = compressRoleOutput(roleName, output);
  const stats = measureCompression(output, compressed);
  ctx.compressionStats.totalSaved += stats.savedTokens;
  ctx.compressionStats.perRole[roleName] = stats;

  // Extract feedback entries from specific role outputs
  const entries = extractFeedbackEntries(roleName, output, iteration);
  if (entries.length > 0) {
    queue.addEntries(ctx.feedbackQueue, entries);
    enrich.enrichQueue(ctx.feedbackQueue);
    queue.deduplicate(ctx.feedbackQueue);
    queue.prioritize(ctx.feedbackQueue);
  }

  return compressed;
}

/**
 * Extract structured feedback entries from a role's output.
 */
function extractFeedbackEntries(roleName, output, iteration) {
  if (!output || typeof output !== "object") return [];

  const entries = [];
  if (roleName === "reviewer" && output.blocking_issues) {
    for (const issue of output.blocking_issues) {
      entries.push({
        source: "reviewer",
        severity: issue.severity || "medium",
        description: issue.description || "",
        file: issue.file || null,
        line: issue.line || null,
        suggestedFix: issue.suggested_fix || null,
        id: issue.id || null,
        iteration
      });
    }
  } else if (roleName === "tester" && output.verdict === "fail") {
    const missing = output.missing_scenarios || [];
    for (const scenario of missing) {
      entries.push({
        source: "tester",
        severity: "high",
        category: "tests",
        description: `Missing scenario: ${scenario}`,
        iteration
      });
    }
    if (output.coverage?.overall != null && output.coverage.overall < 80) {
      entries.push({
        source: "tester",
        severity: "high",
        category: "tests",
        description: `Coverage below 80% (${output.coverage.overall}%)`,
        iteration
      });
    }
  } else if (roleName === "security" && output.verdict === "fail") {
    for (const vuln of output.vulnerabilities || []) {
      entries.push({
        source: "security",
        severity: vuln.severity || "high",
        category: "security",
        description: vuln.description || "",
        file: vuln.file || null,
        line: vuln.line || null,
        suggestedFix: vuln.fix_suggestion || null,
        iteration
      });
    }
  }
  return entries;
}

/**
 * Before coder runs, format the feedback queue as an actionable prompt.
 */
export function buildCoderFeedbackPrompt(ctx) {
  if (!ctx.enabled || ctx.feedbackQueue.entries.length === 0) return null;
  return enrich.formatEnrichedForCoder(ctx.feedbackQueue.entries);
}

/**
 * After coder runs, verify changes were made. Returns verification result.
 */
export function verifyCoderRan(ctx, { baseRef, projectDir }) {
  if (!ctx.enabled) return { passed: true, filesChanged: 0, reason: "brain disabled" };
  const result = verifyCoderOutput({ baseRef, projectDir });
  ctx.verificationTracker.record(result);
  return result;
}

/**
 * Execute direct actions (npm install, gitignore updates, etc.).
 */
export async function runDirectActions(ctx, actions, { cwd } = {}) {
  if (!ctx.enabled || !actions?.length) return [];
  return executeActions(actions, { cwd });
}

/**
 * Clear feedback queue after coder addresses it.
 */
export function clearFeedback(ctx) {
  if (!ctx.enabled) return;
  queue.clear(ctx.feedbackQueue);
}

/**
 * Get a summary of brain activity for the session.
 */
export function summarize(ctx) {
  if (!ctx.enabled) return null;
  return {
    feedbackQueueSize: ctx.feedbackQueue.entries.length,
    queueCategories: queue.countByCategory(ctx.feedbackQueue),
    consecutiveVerificationFailures: ctx.verificationTracker.consecutiveFailures,
    compressionSaved: ctx.compressionStats.totalSaved,
    compressionPerRole: ctx.compressionStats.perRole
  };
}

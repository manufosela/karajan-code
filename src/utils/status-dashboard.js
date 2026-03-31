/**
 * Status dashboard formatter.
 * Builds a structured terminal dashboard from session data and run-log lines.
 */

import { HU_STATUS } from "../hu/store.js";

/**
 * Status label mapping with visual indicators for terminal output.
 * @type {Record<string, string>}
 */
const STATUS_LABELS = {
  [HU_STATUS.PENDING]:       "pending",
  [HU_STATUS.CODING]:        "coding",
  [HU_STATUS.REVIEWING]:     "reviewing",
  [HU_STATUS.DONE]:          "done",
  [HU_STATUS.FAILED]:        "failed",
  [HU_STATUS.BLOCKED]:       "blocked",
  [HU_STATUS.CERTIFIED]:     "certified",
  [HU_STATUS.NEEDS_CONTEXT]: "needs_ctx",
};

/**
 * Format a millisecond duration into a human-readable string (e.g. "3m 42s").
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

/**
 * Parse the current pipeline stage from log lines.
 * @param {string[]} lines - Raw log lines.
 * @returns {{ currentStage: string|null, lastEvent: string|null }}
 */
export function parseStageFromLog(lines) {
  let currentStage = null;
  let lastEvent = null;

  for (const line of lines) {
    const stageStart = /\[(\w+):start\]/.exec(line);
    if (stageStart) currentStage = stageStart[1];

    const stageDone = /\[(\w+):done\]|\[(\w+)\] finished/.exec(line);
    if (stageDone) {
      const doneName = stageDone[1] || stageDone[2];
      if (doneName === currentStage) currentStage = "idle";
    }

    if (line.includes("[standby]") || line.includes("standby")) {
      currentStage = "standby";
    }

    if (line.trim()) lastEvent = line.trim();
  }

  return { currentStage, lastEvent };
}

/**
 * Format a single HU line for the dashboard.
 * @param {object} story - HU story object.
 * @param {boolean} isCurrent - Whether this is the currently active HU.
 * @returns {string}
 */
function formatHuLine(story, isCurrent) {
  const id = (story.id || "???").padEnd(12);
  const rawStatus = story.status || "pending";
  const label = STATUS_LABELS[rawStatus] || rawStatus;
  const statusStr = `[${label}]`.padEnd(13);
  const title = story.title || story.original?.text || "(untitled)";
  const truncTitle = title.length > 40 ? title.slice(0, 37) + "..." : title;

  let timing = "";
  if (story.duration_ms) {
    timing = formatDuration(story.duration_ms);
  }

  const blockedInfo = story.blocked_by?.length
    ? ` (needs ${story.blocked_by.join(", ")})`
    : "";

  const marker = isCurrent ? "  <-- current" : "";
  const timingStr = timing ? `  ${timing}` : "";

  return `  ${id} ${statusStr} ${truncTitle}${blockedInfo}${timingStr}${marker}`;
}

/**
 * Build a terminal dashboard string from session data and log lines.
 *
 * @param {object|null} sessionData - Session JSON (from session-store) or null.
 * @param {string[]} logLines - Raw run-log lines.
 * @param {object} [options] - Optional overrides.
 * @param {object[]|null} [options.stories] - HU stories array (from hu batch).
 * @returns {string}
 */
export function buildDashboard(sessionData, logLines, options = {}) {
  if (!sessionData) {
    return "No active pipeline";
  }

  const lines = [];
  const config = sessionData.config_snapshot || {};
  const maxIter = config.max_iterations ?? "?";
  const status = sessionData.status || "unknown";

  // Parse log for current stage info
  const logInfo = parseStageFromLog(logLines || []);

  // Determine iteration from session or log
  const iteration = sessionData.reviewer_retry_count != null
    ? sessionData.reviewer_retry_count + 1
    : null;
  const iterFromLog = parseIterationFromLog(logLines || []);
  const displayIter = iterFromLog || iteration || "?";

  // Pipeline header
  const statusUpper = status.toUpperCase();
  lines.push(`Pipeline: ${statusUpper} (iteration ${displayIter}/${maxIter})`);

  // Duration
  const duration = computeDuration(sessionData);
  lines.push(`Duration: ${formatDuration(duration)}`);

  // Agent info
  const coderProvider = config.coder?.provider || config.roles?.coder?.provider || "?";
  const reviewerProvider = config.reviewer?.provider || config.roles?.reviewer?.provider || "?";
  lines.push(`Agent: ${coderProvider} (coder) / ${reviewerProvider} (reviewer)`);

  // HU stories section
  const stories = options.stories || [];
  if (stories.length > 0) {
    lines.push("");
    lines.push("HUs:");

    // Determine which story is currently being worked on
    const currentStory = stories.find(s =>
      s.status === HU_STATUS.CODING || s.status === HU_STATUS.REVIEWING
    );

    for (const story of stories) {
      const isCurrent = currentStory && story.id === currentStory.id;
      lines.push(formatHuLine(story, isCurrent));
    }
  }

  // Current stage and last event
  lines.push("");
  const stage = logInfo.currentStage || "idle";
  const iterSuffix = displayIter !== "?" ? ` (iteration ${displayIter})` : "";
  lines.push(`Current stage: ${stage}${iterSuffix}`);

  if (logInfo.lastEvent) {
    // Truncate last event for display
    const maxLen = 120;
    const event = logInfo.lastEvent.length > maxLen
      ? logInfo.lastEvent.slice(0, maxLen - 3) + "..."
      : logInfo.lastEvent;
    lines.push(`Last event: ${event}`);
  }

  // Errors
  if (sessionData.deferred_issues?.length) {
    lines.push("");
    lines.push(`Deferred issues: ${sessionData.deferred_issues.length}`);
  }

  return lines.join("\n");
}

/**
 * Build a structured JSON response for MCP consumers.
 *
 * @param {object|null} sessionData - Session JSON or null.
 * @param {string[]} logLines - Raw run-log lines.
 * @param {object} [options] - Optional overrides.
 * @param {object[]|null} [options.stories] - HU stories array.
 * @returns {object}
 */
export function buildDashboardJson(sessionData, logLines, options = {}) {
  if (!sessionData) {
    return { ok: false, message: "No active pipeline" };
  }

  const config = sessionData.config_snapshot || {};
  const logInfo = parseStageFromLog(logLines || []);
  const iterFromLog = parseIterationFromLog(logLines || []);
  const iteration = iterFromLog
    || (sessionData.reviewer_retry_count != null ? sessionData.reviewer_retry_count + 1 : null);

  const stories = (options.stories || []).map(s => ({
    id: s.id,
    status: s.status || "pending",
    title: s.title || s.original?.text || null,
    blocked_by: s.blocked_by || [],
    duration_ms: s.duration_ms || null,
  }));

  return {
    ok: true,
    pipeline: {
      status: sessionData.status || "unknown",
      iteration: iteration || null,
      maxIterations: config.max_iterations ?? null,
      duration_ms: computeDuration(sessionData),
      coder: config.coder?.provider || config.roles?.coder?.provider || null,
      reviewer: config.reviewer?.provider || config.roles?.reviewer?.provider || null,
    },
    hus: stories,
    currentStage: logInfo.currentStage || "idle",
    lastEvent: logInfo.lastEvent || null,
  };
}

/**
 * Parse iteration number from log lines.
 * @param {string[]} lines
 * @returns {number|null}
 */
function parseIterationFromLog(lines) {
  let iteration = null;
  for (const line of lines) {
    const m = /[Ii]teration\s+(\d+)/.exec(line);
    if (m) iteration = Number.parseInt(m[1], 10);
  }
  return iteration;
}

/**
 * Compute pipeline duration in milliseconds from session timestamps.
 * @param {object} sessionData
 * @returns {number}
 */
function computeDuration(sessionData) {
  const created = sessionData.created_at;
  if (!created) return 0;
  const start = new Date(created).getTime();
  const now = sessionData.updated_at
    ? new Date(sessionData.updated_at).getTime()
    : Date.now();
  return Math.max(0, now - start);
}

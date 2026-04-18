export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  magenta: "\x1b[35m"
};

export const ICONS = {
  "session:start": "\u25b6",
  "planner:start": "\ud83e\udde0",
  "planner:end": "\ud83e\udde0",
  "researcher:start": "\ud83d\udd2c",
  "researcher:end": "\ud83d\udd2c",
  "iteration:start": "\u25b6",
  "coder:start": "\ud83d\udd28",
  "coder:end": "\ud83d\udd28",
  "refactorer:start": "\u267b\ufe0f",
  "refactorer:end": "\u267b\ufe0f",
  "tdd:result": "\ud83d\udccb",
  "sonar:start": "\ud83d\udd0d",
  "sonar:end": "\ud83d\udd0d",
  "reviewer:start": "\ud83d\udc41\ufe0f",
  "reviewer:end": "\ud83d\udc41\ufe0f",
  "tester:start": "\ud83e\uddea",
  "tester:end": "\ud83e\uddea",
  "security:start": "\ud83d\udd12",
  "security:end": "\ud83d\udd12",
  "solomon:start": "\u2696\ufe0f",
  "solomon:end": "\u2696\ufe0f",
  "solomon:escalate": "\u26a0\ufe0f",
  "agent:heartbeat": "\u23f3",
  "coder:standby": "\u23f3",
  "coder:standby_heartbeat": "\u23f3",
  "coder:standby_resume": "\u25b6\ufe0f",
  "budget:update": "\ud83d\udcb8",
  "iteration:end": "\u23f1\ufe0f",
  "session:end": "\ud83c\udfc1",
  "discover:start": "\ud83d\udd0e",
  "discover:end": "\ud83d\udd0e",
  "architect:start": "\ud83c\udfdb\ufe0f",
  "architect:end": "\ud83c\udfdb\ufe0f",
  "hu-reviewer:start": "\ud83d\udcdd",
  "hu-reviewer:end": "\ud83d\udcdd",
  "impeccable:start": "\ud83c\udfa8",
  "impeccable:end": "\ud83c\udfa8",
  "audit:start": "\ud83d\udccb",
  "audit:end": "\ud83d\udccb",
  "sonarcloud:start": "\u2601\ufe0f",
  "sonarcloud:end": "\u2601\ufe0f",
  "preflight:start": "\ud83d\udee1\ufe0f",
  "preflight:end": "\ud83d\udee1\ufe0f",
  question: "\u2753"
};

export const STATUS_ICON = {
  ok: `${ANSI.green}\u2705${ANSI.reset}`,
  fail: `${ANSI.red}\u274c${ANSI.reset}`,
  paused: `${ANSI.yellow}\u23f8\ufe0f${ANSI.reset}`,
  running: `${ANSI.cyan}\u25b6${ANSI.reset}`
};

export const TRACKER_STATUS = {
  done:    { icon: "\u2713", color: ANSI.green },
  running: { icon: "\u25b6", color: ANSI.cyan },
  failed:  { icon: "\u2717", color: ANSI.red }
};

export const TRACKER_DEFAULT = { icon: "\u00b7", color: ANSI.dim };

/**
 * Format milliseconds into MM:SS string
 * @param {number} ms 
 * @returns {string}
 */
export function formatElapsed(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const min = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const sec = String(totalSec % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

/**
 * Format executor details into a display string
 * @param {Object} detail 
 * @returns {string}
 */
export function formatExecutor(detail) {
  if (!detail) return '';
  const provider = detail.provider || '';
  const type = detail.executorType || '';
  if (provider) return `  ${ANSI.dim}${provider}${ANSI.reset}`;
  if (type === 'local') return `  ${ANSI.dim}local${ANSI.reset}`;
  if (type === 'system') return `  ${ANSI.dim}system${ANSI.reset}`;
  return '';
}

/**
 * Calculate budget ANSI color based on usage
 * @param {number} max 
 * @param {number} pct 
 * @param {number} warn 
 * @returns {string}
 */
export function budgetColor(max, pct, warn) {
  if (max > 0 && pct >= 100) return ANSI.red;
  if (max > 0 && pct >= warn) return ANSI.yellow;
  return ANSI.green;
}

export function roleStart(icon, label, provider) {
  console.log(`  \u251c\u2500 ${icon} ${label} (${provider || "?"}) running...`);
}

export function roleEnd(status, label, elapsed, executor) {
  console.log(`  \u251c\u2500 ${status} ${label} completed${executor || ''}  ${elapsed}`);
}

export function passFailStage(detail, label, failDefault, elapsed) {
  const executor = formatExecutor(detail);
  if (detail?.ok === false) {
    const summary = detail?.summary || failDefault;
    console.log(`  \u251c\u2500 ${ANSI.red}\u274c ${label}: ${summary}${ANSI.reset}${executor}  ${elapsed}`);
  } else {
    console.log(`  \u251c\u2500 ${ANSI.green}\u2705 ${label}: passed${ANSI.reset}${executor}  ${elapsed}`);
  }
}

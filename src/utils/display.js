import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// TODO: i18n display messages
const DISPLAY_PKG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
const DISPLAY_VERSION = JSON.parse(readFileSync(DISPLAY_PKG_PATH, "utf8")).version;

const ANSI = {
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

const ICONS = {
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

const STATUS_ICON = {
  ok: `${ANSI.green}\u2705${ANSI.reset}`,
  fail: `${ANSI.red}\u274c${ANSI.reset}`,
  paused: `${ANSI.yellow}\u23f8\ufe0f${ANSI.reset}`,
  running: `${ANSI.cyan}\u25b6${ANSI.reset}`
};

export function formatElapsed(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const min = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const sec = String(totalSec % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

const BAR = `${ANSI.dim}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${ANSI.reset}`;

export function printHeader({ task, config }) {
  const version = DISPLAY_VERSION;
  console.log(BAR);
  console.log(`${ANSI.bold}${ANSI.cyan}\u25b6 Karajan Code v${version}${ANSI.reset}`);
  console.log(BAR);
  console.log(`${ANSI.bold}Task:${ANSI.reset} ${task}`);
  console.log(
    `${ANSI.bold}Coder:${ANSI.reset} ${config.roles?.coder?.provider || config.coder} ${ANSI.dim}|${ANSI.reset} ${ANSI.bold}Reviewer:${ANSI.reset} ${config.roles?.reviewer?.provider || config.reviewer}`
  );
  console.log(
    `${ANSI.bold}Max iterations:${ANSI.reset} ${config.max_iterations} ${ANSI.dim}|${ANSI.reset} ${ANSI.bold}Timeout:${ANSI.reset} ${config.session.max_total_minutes}min`
  );

  const pipeline = config.pipeline || {};
  const activeRoles = [];
  if (pipeline.planner?.enabled) activeRoles.push(`Planner (${config.roles?.planner?.provider || "?"})`);
  if (pipeline.researcher?.enabled) activeRoles.push(`Researcher (${config.roles?.researcher?.provider || "?"})`);
  if (pipeline.tester?.enabled) activeRoles.push("Tester");
  if (pipeline.security?.enabled) activeRoles.push("Security");
  if (pipeline.solomon?.enabled) activeRoles.push(`Solomon (${config.roles?.solomon?.provider || "?"})`);
  if (activeRoles.length > 0) {
    const separator = ` ${ANSI.dim}|${ANSI.reset} `;
    console.log(`${ANSI.bold}Pipeline:${ANSI.reset} ${activeRoles.join(separator)}`);
  }

  console.log(BAR);
  console.log();
}

/* ── Helper: executor/provider tag ───────────────────────────── */

function formatExecutor(detail) {
  if (!detail) return '';
  const provider = detail.provider || '';
  const type = detail.executorType || '';
  if (provider) return `  ${ANSI.dim}${provider}${ANSI.reset}`;
  if (type === 'local') return `  ${ANSI.dim}local${ANSI.reset}`;
  if (type === 'system') return `  ${ANSI.dim}system${ANSI.reset}`;
  return '';
}

/* ── Helper: role start/end one-liners ───────────────────────── */

function roleStart(icon, label, provider) {
  console.log(`  \u251c\u2500 ${icon} ${label} (${provider || "?"}) running...`);
}

function roleEnd(status, label, elapsed, executor) {
  console.log(`  \u251c\u2500 ${status} ${label} completed${executor || ''}  ${elapsed}`);
}

/* ── Helper: pass/fail stage result ─────────────────────────── */

function passFailStage(detail, label, failDefault, elapsed) {
  const executor = formatExecutor(detail);
  if (detail?.ok === false) {
    const summary = detail?.summary || failDefault;
    console.log(`  \u251c\u2500 ${ANSI.red}\u274c ${label}: ${summary}${ANSI.reset}${executor}  ${elapsed}`);
  } else {
    console.log(`  \u251c\u2500 ${ANSI.green}\u2705 ${label}: passed${ANSI.reset}${executor}  ${elapsed}`);
  }
}

/* ── Helper: solomon ruling display ─────────────────────────── */

const SOLOMON_RULING_HANDLERS = {
  approve(detail, elapsed) {
    const dismissedCount = detail?.dismissed?.length || 0;
    const dismissedSuffix = dismissedCount > 0 ? ` (${dismissedCount} dismissed)` : "";
    console.log(`  \u251c\u2500 ${ANSI.green}\u2696\ufe0f Solomon: APPROVE${dismissedSuffix}${ANSI.reset}  ${elapsed}`);
  },
  approve_with_conditions(detail, elapsed) {
    const condCount = detail?.conditions?.length || 0;
    console.log(`  \u251c\u2500 ${ANSI.yellow}\u2696\ufe0f Solomon: ${condCount} condition${condCount === 1 ? "" : "s"}${ANSI.reset}  ${elapsed}`);
    if (detail?.conditions) {
      for (const cond of detail.conditions) {
        console.log(`  \u2502   ${ANSI.dim}${cond}${ANSI.reset}`);
      }
    }
  },
  escalate_human(detail, elapsed) {
    const reason = detail?.escalate_reason || "unknown reason";
    console.log(`  \u251c\u2500 ${ANSI.red}\u2696\ufe0f Solomon: ESCALATE \u2014 ${reason}${ANSI.reset}  ${elapsed}`);
  },
  create_subtask(detail, elapsed) {
    const subtaskTitle = detail?.subtask?.title || "untitled";
    console.log(`  \u251c\u2500 ${ANSI.magenta}\u2696\ufe0f Solomon: SUBTASK \u2014 ${subtaskTitle}${ANSI.reset}  ${elapsed}`);
  }
};

function printSolomonRuling(detail, elapsed) {
  const ruling = detail?.ruling || "unknown";
  const handler = SOLOMON_RULING_HANDLERS[ruling];
  if (handler) {
    handler(detail, elapsed);
  } else {
    const rulingUpper = ruling.toUpperCase().replaceAll("_", " ");
    console.log(`  \u251c\u2500 \u2696\ufe0f Solomon: ${rulingUpper}  ${elapsed}`);
  }
}

/* ── Helper: budget color selection ─────────────────────────── */

function budgetColor(max, pct, warn) {
  if (max > 0 && pct >= 100) return ANSI.red;
  if (max > 0 && pct >= warn) return ANSI.yellow;
  return ANSI.green;
}

/* ── Helpers: session:end sub-sections ──────────────────────── */

function printSessionStages(stages) {
  if (!stages) return;
  if (stages.researcher?.summary) {
    console.log(`  ${ANSI.dim}\ud83d\udd2c Research: ${stages.researcher.summary}${ANSI.reset}`);
  }
  printSessionPlanner(stages.planner);
  if (stages.tester?.summary) {
    console.log(`  ${ANSI.dim}\ud83e\uddea Tester: ${stages.tester.summary}${ANSI.reset}`);
  }
  if (stages.security?.summary) {
    console.log(`  ${ANSI.dim}\ud83d\udd12 Security: ${stages.security.summary}${ANSI.reset}`);
  }
  printSessionSonar(stages.sonar);
}

function printSessionPlanner(planner) {
  if (!planner?.title && !planner?.approach && !planner?.completedSteps?.length) return;
  const planParts = [];
  if (planner.title) planParts.push(planner.title);
  if (planner.approach) planParts.push(`approach: ${planner.approach}`);
  console.log(`  ${ANSI.dim}\ud83d\uddfa Plan: ${planParts.join(" | ")}${ANSI.reset}`);
  for (const step of planner.completedSteps || []) {
    console.log(`  ${ANSI.dim}   \u2713 ${step}${ANSI.reset}`);
  }
}

function printSessionSonar(sonar) {
  if (!sonar) return;
  const gateLabel = sonar.gateStatus === "OK" ? ANSI.green : ANSI.red;
  console.log(`  ${ANSI.dim}\ud83d\udd0d Sonar: ${gateLabel}${sonar.gateStatus}${ANSI.reset}${ANSI.dim} (${sonar.openIssues ?? 0} issues)${ANSI.reset}`);
  if (typeof sonar.issuesInitial === "number" || typeof sonar.issuesResolved === "number") {
    const issuesInitial = sonar.issuesInitial ?? sonar.openIssues ?? 0;
    const issuesFinal = sonar.issuesFinal ?? sonar.openIssues ?? 0;
    const issuesResolved = sonar.issuesResolved ?? Math.max(issuesInitial - issuesFinal, 0);
    console.log(`  ${ANSI.dim}\ud83d\udee0 Issues: ${issuesInitial} detected, ${issuesFinal} open, ${issuesResolved} resolved${ANSI.reset}`);
  }
}

function printSessionGit(git) {
  if (!git?.branch) return;
  const parts = [`branch: ${git.branch}`];
  if (git.committed) parts.push("committed");
  if (git.pushed) parts.push("pushed");
  if (git.pr || git.prUrl) parts.push(`PR: ${git.pr || git.prUrl}`);
  console.log(`  ${ANSI.dim}\ud83d\udcce Git: ${parts.join(", ")}${ANSI.reset}`);
  if (Array.isArray(git.commits) && git.commits.length > 0) {
    console.log(`  ${ANSI.dim}\ud83e\uddfe Commits:${ANSI.reset}`);
    for (const commit of git.commits) {
      const shortHash = (commit.hash || "").slice(0, 7) || "unknown";
      const message = commit.message || "";
      console.log(`  ${ANSI.dim}   - ${shortHash} ${message}${ANSI.reset}`);
    }
  }
}

function isBudgetUnavailable(budget) {
  return budget.usage_available === false ||
    (budget.total_tokens === 0 && budget.total_cost_usd === 0 && Object.keys(budget.breakdown_by_role || {}).length > 0);
}

function printSessionRtkSavings(rtkSavings) {
  if (!rtkSavings || !rtkSavings.callCount) return;
  const tokens = rtkSavings.estimatedTokensSaved ?? 0;
  const ratio = rtkSavings.savedPct ?? 0;
  const commands = rtkSavings.callCount ?? 0;
  console.log(`  ${ANSI.dim}\u26a1 RTK: saved ~${tokens} tokens (${ratio}% compression, ${commands} commands)${ANSI.reset}`);
}

function printSessionBudget(budget) {
  if (!budget) return;
  if (isBudgetUnavailable(budget)) {
    console.log(`  ${ANSI.dim}\ud83d\udcb0 Budget: N/A (provider does not report usage)${ANSI.reset}`);
    return;
  }
  const estPrefix = budget.includes_estimates ? "~" : "";
  const estNote = budget.includes_estimates ? " (includes estimates)" : "";
  console.log(`  ${ANSI.dim}\ud83d\udcb0 Total tokens: ${estPrefix}${budget.total_tokens ?? 0}${estNote}${ANSI.reset}`);
  console.log(`  ${ANSI.dim}\ud83d\udcb0 Total cost: ${estPrefix}$${Number(budget.total_cost_usd || 0).toFixed(2)}${ANSI.reset}`);
  for (const [role, metrics] of Object.entries(budget.breakdown_by_role || {})) {
    console.log(
      `  ${ANSI.dim}   - ${role}: ${estPrefix}${metrics.total_tokens ?? 0} tokens, ${estPrefix}$${Number(metrics.total_cost_usd || 0).toFixed(2)}${ANSI.reset}`
    );
  }
}

/* ── Helper: pipeline tracker stage icon/color ──────────────── */

const TRACKER_STATUS = {
  done:    { icon: "\u2713", color: ANSI.green },
  running: { icon: "\u25b6", color: ANSI.cyan },
  failed:  { icon: "\u2717", color: ANSI.red }
};
const TRACKER_DEFAULT = { icon: "\u00b7", color: ANSI.dim };

/* ── Event handler map ──────────────────────────────────────── */

const EVENT_HANDLERS = {
  "session:start": () => {},

  "iteration:start": (event, icon, elapsed) => {
    const retryCount = event.detail?.reviewerRetryCount || 0;
    const maxRetries = event.detail?.maxReviewerRetries;
    const retrySuffix = retryCount > 0 && maxRetries
      ? ` ${ANSI.dim}\u2014 reviewer retry ${retryCount}/${maxRetries}${ANSI.reset}`
      : "";
    console.log(
      `\n${ANSI.bold}${icon} Iteration ${event.detail?.iteration}/${event.detail?.maxIterations}${ANSI.reset}${retrySuffix}  ${elapsed}`
    );
  },

  "planner:start": (event, icon) => {
    roleStart(icon, "Planner", event.detail?.planner);
  },

  "planner:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "Planner", elapsed, formatExecutor(event.detail));
  },

  "coder:start": (event, icon) => {
    roleStart(icon, "Coder", event.detail?.coder);
  },

  "coder:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "Coder", elapsed, formatExecutor(event.detail));
  },

  "refactorer:start": (event, icon) => {
    roleStart(icon, "Refactorer", event.detail?.refactorer);
  },

  "refactorer:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "Refactorer", elapsed, formatExecutor(event.detail));
  },

  "tdd:result": (event, icon) => {
    const tdd = event.detail || {};
    const label = tdd.ok ? `${ANSI.green}PASS${ANSI.reset}` : `${ANSI.red}FAIL${ANSI.reset}`;
    const files = tdd.sourceFiles === undefined ? "" : ` (${tdd.sourceFiles} src, ${tdd.testFiles} test)`;
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 ${icon} TDD policy: ${label}${files}${executor}`);
  },

  "researcher:start": (event, icon) => {
    console.log(`  \u251c\u2500 ${icon} Researcher (${event.detail?.researcher || "?"}) investigating...`);
  },

  "researcher:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "Researcher", elapsed, formatExecutor(event.detail));
  },

  "sonar:start": (event, icon) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 ${icon} SonarQube scanning...${executor}`);
  },

  "sonar:end": (event, _icon, elapsed, status) => {
    const gate = event.detail?.gateStatus || "?";
    const gateColor = gate === "OK" ? ANSI.green : ANSI.red;
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 ${status} Quality gate: ${gateColor}${gate}${ANSI.reset}${executor}  ${elapsed}`);
  },

  "reviewer:start": (event, icon) => {
    console.log(`  \u251c\u2500 ${icon} Reviewer (${event.detail?.reviewer || "?"}) running...`);
  },

  "reviewer:end": (event, _icon, elapsed) => {
    const review = event.detail || {};
    const executor = formatExecutor(event.detail);
    if (review.approved) {
      console.log(`  \u251c\u2500 ${ANSI.green}\u2705 Review: APPROVED${ANSI.reset}${executor}  ${elapsed}`);
    } else {
      const count = review.blockingCount || 0;
      console.log(`  \u251c\u2500 ${ANSI.red}\u274c Review: REJECTED (${count} blocking)${ANSI.reset}${executor}`);
      if (review.issues) {
        for (const issue of review.issues) {
          console.log(`  \u2502   ${ANSI.dim}${issue}${ANSI.reset}`);
        }
      }
    }
  },

  "tester:start": (event, icon) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 ${icon} Tester evaluating...${executor}`);
  },

  "tester:end": (event, _icon, elapsed) => {
    passFailStage(event.detail, "Tester", "issues found", elapsed);
  },

  "security:start": (event, icon) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 ${icon} Security auditing...${executor}`);
  },

  "security:end": (event, _icon, elapsed) => {
    passFailStage(event.detail, "Security", "vulnerabilities found", elapsed);
  },

  "solomon:start": (event, icon) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 ${icon} Solomon arbitrating ${event.detail?.conflictStage || "?"} conflict...${executor}`);
  },

  "solomon:end": (event, _icon, elapsed) => {
    printSolomonRuling(event.detail, elapsed);
  },

  "solomon:escalate": (event, icon) => {
    const subloop = event.detail?.subloop || "?";
    const retryCount = event.detail?.retryCount || 0;
    const limit = event.detail?.limit || "?";
    console.log(`  \u251c\u2500 ${icon} ${subloop} sub-loop limit reached (${retryCount}/${limit}), invoking Solomon...`);
  },

  "coder:standby": (event, icon) => {
    const until = event.detail?.cooldownUntil || "?";
    const attempt = event.detail?.retryCount || "?";
    const maxRetries = event.detail?.maxRetries || "?";
    console.log(`  \u251c\u2500 ${ANSI.yellow}${icon} Rate limited \u2014 standby until ${until} (attempt ${attempt}/${maxRetries})${ANSI.reset}`);
  },

  "coder:standby_heartbeat": (event, icon) => {
    const remaining = event.detail?.remainingMs === undefined ? "?" : Math.round(event.detail.remainingMs / 1000);
    console.log(`  \u251c\u2500 ${ANSI.yellow}${icon} Standby: ${remaining}s remaining${ANSI.reset}`);
  },

  "coder:standby_resume": (event, icon) => {
    console.log(`  \u251c\u2500 ${ANSI.green}${icon} Cooldown expired \u2014 resuming with ${event.detail?.coder || event.detail?.provider || "?"}${ANSI.reset}`);
  },

  "iteration:end": (event, icon, elapsed) => {
    console.log(`  \u2514\u2500 ${icon} Duration: ${formatElapsed(event.detail?.duration)}  ${elapsed}`);
  },

  "budget:update": (event, icon) => {
    const d = event.detail || {};
    const total = Number(d.total_cost_usd || 0);
    const totalTokens = Number(d.total_tokens || 0);
    const max = Number(d.max_budget_usd);
    const pct = Number(d.pct_used ?? 0);
    const warn = Number(d.warn_threshold_pct ?? 80);
    const hasEntries = (d.entries?.length ?? 0) > 0 || Object.keys(d.breakdown_by_role || {}).length > 0;
    if (hasEntries && totalTokens === 0 && total === 0) {
      console.log(`  \u251c\u2500 ${icon} Budget: ${ANSI.dim}N/A (provider does not report usage)${ANSI.reset}`);
      return;
    }
    const color = budgetColor(max, pct, warn);
    if (Number.isFinite(max) && max >= 0) {
      console.log(`  \u251c\u2500 ${icon} Budget: ${color}$${total.toFixed(2)} / $${max.toFixed(2)} (${pct.toFixed(1)}%)${ANSI.reset}`);
    }
  },

  "session:end": (event, icon, elapsed) => {
    console.log();
    const resultLabel = event.detail?.approved
      ? `${ANSI.bold}${ANSI.green}APPROVED${ANSI.reset}`
      : `${ANSI.bold}${ANSI.red}${event.detail?.reason || "FAILED"}${ANSI.reset}`;
    console.log(`${icon} Result: ${resultLabel}  ${elapsed}`);
    printSessionStages(event.detail?.stages);
    printSessionGit(event.detail?.git);
    printSessionBudget(event.detail?.budget);
    printSessionRtkSavings(event.detail?.rtk_savings);
    console.log(`${ANSI.dim}Session: ${event.sessionId}${ANSI.reset}`);
  },

  question: (event, icon) => {
    console.log();
    console.log(`${ANSI.bold}${ANSI.yellow}${icon} Paused - question:${ANSI.reset}`);
    const questionText = event.detail?.question || event.message || "";
    const questionLines = questionText.split("\n");
    for (const line of questionLines) {
      console.log(`  ${line}`);
    }
    console.log(`${ANSI.dim}Resume with: kj resume ${event.sessionId} --answer "<response>"${ANSI.reset}`);
  },

  "preflight:start": (event) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 \ud83d\udee1\ufe0f Preflight checks running...${executor}`);
  },

  "preflight:end": (event, _icon, elapsed) => {
    const executor = formatExecutor(event.detail);
    const ok = event.status === "ok";
    const statusIcon = ok ? `${ANSI.green}\u2705` : `${ANSI.red}\u274c`;
    console.log(`  \u251c\u2500 ${statusIcon} Preflight: ${event.message}${ANSI.reset}${executor}  ${elapsed}`);
  },

  "discover:start": (event, icon) => {
    const provider = event.detail?.provider || event.detail?.discover || "?";
    console.log(`  \u251c\u2500 ${icon || "\ud83d\udd0e"} Discover (${provider}) analyzing...`);
  },

  "discover:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "Discover", elapsed, formatExecutor(event.detail));
  },

  "architect:start": (event) => {
    const provider = event.detail?.provider || event.detail?.architect || "?";
    console.log(`  \u251c\u2500 \ud83c\udfdb\ufe0f Architect (${provider}) designing...`);
  },

  "architect:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "Architect", elapsed, formatExecutor(event.detail));
  },

  "hu-reviewer:start": (event) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 \ud83d\udcdd HU Reviewer certifying...${executor}`);
  },

  "hu-reviewer:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "HU Reviewer", elapsed, formatExecutor(event.detail));
  },

  "impeccable:start": (event) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 \ud83c\udfa8 Impeccable auditing design...${executor}`);
  },

  "impeccable:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "Impeccable", elapsed, formatExecutor(event.detail));
  },

  "audit:start": (event) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 \ud83d\udccb Final audit running...${executor}`);
  },

  "audit:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "Audit", elapsed, formatExecutor(event.detail));
  },

  "sonarcloud:start": (event) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 \u2601\ufe0f SonarCloud scanning...${executor}`);
  },

  "sonarcloud:end": (event, _icon, elapsed, status) => {
    roleEnd(status, "SonarCloud", elapsed, formatExecutor(event.detail));
  },

  "guard:output": (event) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 \ud83d\udee1\ufe0f ${event.message}${executor}`);
  },

  "guard:perf": (event) => {
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 \u26a1 ${event.message}${executor}`);
  },

  "pipeline:tracker": (event) => {
    const trackerStages = event.detail?.stages || [];
    console.log(`  ${ANSI.dim}\u250c Pipeline${ANSI.reset}`);
    for (const stage of trackerStages) {
      const { icon: stIcon, color: stColor } = TRACKER_STATUS[stage.status] || TRACKER_DEFAULT;
      let suffix = "";
      if (stage.summary) {
        suffix = stage.status === "running" ? ` (${stage.summary})` : ` \u2192 ${stage.summary}`;
      }
      console.log(`  ${ANSI.dim}\u2502${ANSI.reset} ${stColor}${stIcon} ${stage.name}${suffix}${ANSI.reset}`);
    }
    console.log(`  ${ANSI.dim}\u2514${ANSI.reset}`);
  },

  "session:checkpoint": (event) => {
    const d = event.detail || {};
    if (d.auto_continued) {
      console.log(`  \u251c\u2500 ${ANSI.dim}\u2714 Checkpoint: auto-continuing (${d.reason || "progress"})${ANSI.reset}`);
    } else {
      console.log(`  \u251c\u2500 ${ANSI.yellow}\u23f8\ufe0f Interactive checkpoint at ${d.elapsed_minutes?.toFixed(1) || "?"}min${ANSI.reset}`);
    }
  },

  "becaria:pr-created": (event) => {
    const url = event.detail?.prUrl || "";
    console.log(`  \u251c\u2500 ${ANSI.green}\ud83d\ude80 BecarIA PR created: ${url}${ANSI.reset}`);
  },

  "solomon:alert": (event) => {
    console.log(`  \u251c\u2500 ${ANSI.yellow}\u2696\ufe0f Solomon alert: ${event.message || "conflict detected"}${ANSI.reset}`);
  },

  "agent:output": (event) => {
    console.log(`  \u2502 ${ANSI.dim}${event.message}${ANSI.reset}`);
  }
};

/* ── Quiet-mode filter ──────────────────────────────────────── */

/** Event types suppressed in quiet mode (internal/noise events). */
const QUIET_SUPPRESSED = new Set([
  "agent:output",
  "agent:stall",
  "agent:heartbeat",
  "pipeline:simplify",
  "pipeline:analysis-only",
  "policies:resolved",
  "intent:classified",
  "skills:auto-install",
  "context:loaded",
  "rtk:detected",
  "proxy:started",
  "board:started",
  "plan:loaded",
  "tdd:auto-detect",
  "dry-run:summary",
  "pg:decompose",
  "tester:auto-continue",
  "security:auto-continue",
  "hu:sub-pipeline:start",
  "hu:sub-pipeline:end",
  "resilient:auto_resume",
  "guard:blocked",
]);

/* ── Main entry point ───────────────────────────────────────── */

/**
 * @param {object} event
 * @param {object} [opts]
 * @param {boolean} [opts.quiet] - When true, suppress raw agent output lines.
 */
export function printEvent(event, opts = {}) {
  if (opts.quiet && QUIET_SUPPRESSED.has(event.type)) {
    return;
  }

  const icon = ICONS[event.type] || "\u2022";
  const elapsed = event.elapsed === undefined ? "" : `${ANSI.dim}[${formatElapsed(event.elapsed)}]${ANSI.reset}`;
  const status = event.status ? STATUS_ICON[event.status] || "" : "";

  const handler = EVENT_HANDLERS[event.type];
  if (handler) {
    handler(event, icon, elapsed, status);
  } else if (event.message) {
    console.log(`  \u251c\u2500 ${icon} ${event.message}  ${elapsed}`);
  }
  // Events without handler AND without message are silently dropped
}

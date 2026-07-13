import { 
  ANSI, 
  formatElapsed, 
  formatExecutor, 
  budgetColor, 
  roleStart, 
  roleEnd, 
  passFailStage, 
  TRACKER_STATUS, 
  TRACKER_DEFAULT, 
  ICONS, 
  STATUS_ICON 
} from "./formatters.js";
import { printSolomonRuling } from "./solomon.js";
import { 
  printSessionStages, 
  printSessionGit, 
  printSessionBudget, 
  printSessionRtkSavings
} from "./session-summary.js";

export const EVENT_HANDLERS = {
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
    if (tdd.reason === "no_diff_available") {
      console.log(`  \u251c\u2500 ${icon} TDD policy: ${ANSI.yellow}SKIP${ANSI.reset} ${ANSI.dim}(no diff available)${ANSI.reset}`);
      return;
    }
    const label = tdd.ok ? `${ANSI.green}PASS${ANSI.reset}` : `${ANSI.red}FAIL${ANSI.reset}`;
    const files = tdd.sourceFiles === undefined ? "" : ` (${tdd.sourceFiles} src, ${tdd.testFiles} test)`;
    const executor = formatExecutor(event.detail);
    console.log(`  \u251c\u2500 ${icon} TDD policy: ${label}${files}${executor}`);
  },

  "triage:end": (event, icon, elapsed, status) => {
    const detail = event.detail || {};
    const level = detail.level ? ` ${detail.level}` : "";
    const onCount = detail.roles?.length || 0;
    console.log(
      `  \u251c\u2500 ${icon} ${status} Triage${level}${ANSI.dim} \u2014 ${onCount} role(s) on${ANSI.reset}  ${elapsed}`
    );
    // Per-role rationale: why each role was activated or skipped (KJC-TSK-0601).
    for (const entry of detail.roleRationale || []) {
      const mark = entry.enabled ? `${ANSI.green}\u2713${ANSI.reset}` : `${ANSI.dim}\u2717${ANSI.reset}`;
      console.log(`  \u2502    ${mark} ${ANSI.dim}${entry.role}: ${entry.reason}${ANSI.reset}`);
    }
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

  "agent:heartbeat": (event, icon) => {
    const d = event.detail || {};
    const provider = d.provider || "?";
    const elapsed = d.elapsedMs ? Math.round(d.elapsedMs / 1000) : 0;
    const silent = d.silenceMs ? Math.round(d.silenceMs / 1000) : 0;
    const status = d.status === "waiting" ? `${ANSI.yellow}waiting (silent ${silent}s)` : `${ANSI.green}working`;
    console.log(`  \u251c\u2500 ${ANSI.dim}${icon} ${provider} ${status}${ANSI.dim} — ${elapsed}s elapsed${ANSI.reset}`);
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
    // Don't show N/A — just skip budget display when there's nothing to report
    if (total === 0 && totalTokens === 0) return;
    const fmtTokens = (n) => n.toLocaleString("en-US");
    const tokenStr = totalTokens > 0 ? ` / ${fmtTokens(totalTokens)} tokens` : "";
    const costStr = `$${total.toFixed(2)}`;
    const color = budgetColor(max, pct, warn);
    if (Number.isFinite(max) && max > 0) {
      console.log(`  \u251c\u2500 ${icon} Budget: ${color}${costStr}${tokenStr} / $${max.toFixed(2)} (${pct.toFixed(1)}%)${ANSI.reset}`);
    } else {
      console.log(`  \u251c\u2500 ${icon} Budget: ${color}${costStr}${tokenStr}${ANSI.reset}`);
    }
    // KJC-TSK-0274: show "With KJ vs Without KJ" comparison when the
    // pipeline has compression data. Silently skipped when absent (AC).
    const cmp = d.kj_comparison;
    if (cmp?.hasCompression) {
      const withoutCost = `$${Number(cmp.withoutKj?.cost || 0).toFixed(2)}`;
      const withoutTok = fmtTokens(Number(cmp.withoutKj?.tokens || 0));
      console.log(`  \u2502    ${ANSI.dim}\u2937 Without KJ: ~${withoutCost} / ~${withoutTok} tokens (-${Math.round(cmp.savedPct)}%)${ANSI.reset}`);
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

  "ci:pr-created": (event) => {
    const url = event.detail?.prUrl || "";
    console.log(`  \u251c\u2500 ${ANSI.green}\ud83d\ude80 CI PR created: ${url}${ANSI.reset}`);
  },

  "brain:rules-alert": (event) => {
    console.log(`  \u251c\u2500 ${ANSI.yellow}\u26a0\ufe0f  Rules alert: ${event.message || "anomaly detected"}${ANSI.reset}`);
  },

  "agent:output": (event) => {
    console.log(`  \u2502 ${ANSI.dim}${event.message}${ANSI.reset}`);
  },

  "agent:action": (event) => {
    console.log(`  \u2502 ${ANSI.dim}\u2937 ${event.message}${ANSI.reset}`);
  }
};

/** Event types suppressed in quiet mode (internal/noise events). */
const QUIET_SUPPRESSED = new Set([
  "agent:output",
  "agent:stall",
  "pipeline:simplify",
  "pipeline:analysis-only",
  "policies:resolved",
  "intent:classified",
  "skills:auto-install",
  "context:loaded",
  "rtk:detected",
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

/**
 * Handle and print pipeline events
 * @param {Object} event 
 * @param {Object} [opts] 
 * @param {boolean} [opts.quiet] 
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
}

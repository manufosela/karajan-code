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
  "iteration:end": "\u23f1\ufe0f",
  "session:end": "\ud83c\udfc1",
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
  const version = "0.1.0";
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
    console.log(`${ANSI.bold}Pipeline:${ANSI.reset} ${activeRoles.join(` ${ANSI.dim}|${ANSI.reset} `)}`);
  }

  console.log(BAR);
  console.log();
}

export function printEvent(event) {
  const icon = ICONS[event.type] || "\u2022";
  const elapsed = event.elapsed !== undefined ? `${ANSI.dim}[${formatElapsed(event.elapsed)}]${ANSI.reset}` : "";
  const status = event.status ? STATUS_ICON[event.status] || "" : "";

  switch (event.type) {
    case "session:start":
      break;

    case "iteration:start":
      console.log(
        `\n${ANSI.bold}${icon} Iteration ${event.detail?.iteration}/${event.detail?.maxIterations}${ANSI.reset}  ${elapsed}`
      );
      break;

    case "planner:start":
      console.log(`  \u251c\u2500 ${icon} Planner (${event.detail?.planner || "?"}) running...`);
      break;

    case "planner:end":
      console.log(`  \u251c\u2500 ${status} Planner completed  ${elapsed}`);
      break;

    case "coder:start":
      console.log(`  \u251c\u2500 ${icon} Coder (${event.detail?.coder || "?"}) running...`);
      break;

    case "coder:end":
      console.log(`  \u251c\u2500 ${status} Coder completed  ${elapsed}`);
      break;

    case "refactorer:start":
      console.log(`  \u251c\u2500 ${icon} Refactorer (${event.detail?.refactorer || "?"}) running...`);
      break;

    case "refactorer:end":
      console.log(`  \u251c\u2500 ${status} Refactorer completed  ${elapsed}`);
      break;

    case "tdd:result": {
      const tdd = event.detail || {};
      const label = tdd.ok ? `${ANSI.green}PASS${ANSI.reset}` : `${ANSI.red}FAIL${ANSI.reset}`;
      const files = tdd.sourceFiles !== undefined ? ` (${tdd.sourceFiles} src, ${tdd.testFiles} test)` : "";
      console.log(`  \u251c\u2500 ${icon} TDD policy: ${label}${files}`);
      break;
    }

    case "researcher:start":
      console.log(`  \u251c\u2500 ${icon} Researcher (${event.detail?.researcher || "?"}) investigating...`);
      break;

    case "researcher:end":
      console.log(`  \u251c\u2500 ${status} Researcher completed  ${elapsed}`);
      break;

    case "sonar:start":
      console.log(`  \u251c\u2500 ${icon} SonarQube scanning...`);
      break;

    case "sonar:end": {
      const gate = event.detail?.gateStatus || "?";
      const gateColor = gate === "OK" ? ANSI.green : ANSI.red;
      console.log(`  \u251c\u2500 ${status} Quality gate: ${gateColor}${gate}${ANSI.reset}  ${elapsed}`);
      break;
    }

    case "reviewer:start":
      console.log(`  \u251c\u2500 ${icon} Reviewer (${event.detail?.reviewer || "?"}) running...`);
      break;

    case "reviewer:end": {
      const review = event.detail || {};
      if (review.approved) {
        console.log(`  \u251c\u2500 ${ANSI.green}\u2705 Review: APPROVED${ANSI.reset}  ${elapsed}`);
      } else {
        const count = review.blockingCount || 0;
        console.log(`  \u251c\u2500 ${ANSI.red}\u274c Review: REJECTED (${count} blocking)${ANSI.reset}`);
        if (review.issues) {
          for (const issue of review.issues) {
            console.log(`  \u2502   ${ANSI.dim}${issue}${ANSI.reset}`);
          }
        }
      }
      break;
    }

    case "tester:start":
      console.log(`  \u251c\u2500 ${icon} Tester evaluating...`);
      break;

    case "tester:end": {
      const testerOk = event.detail?.ok !== false;
      if (testerOk) {
        console.log(`  \u251c\u2500 ${ANSI.green}\u2705 Tester: passed${ANSI.reset}  ${elapsed}`);
      } else {
        const testerSummary = event.detail?.summary || "issues found";
        console.log(`  \u251c\u2500 ${ANSI.red}\u274c Tester: ${testerSummary}${ANSI.reset}  ${elapsed}`);
      }
      break;
    }

    case "security:start":
      console.log(`  \u251c\u2500 ${icon} Security auditing...`);
      break;

    case "security:end": {
      const secOk = event.detail?.ok !== false;
      if (secOk) {
        console.log(`  \u251c\u2500 ${ANSI.green}\u2705 Security: passed${ANSI.reset}  ${elapsed}`);
      } else {
        const secSummary = event.detail?.summary || "vulnerabilities found";
        console.log(`  \u251c\u2500 ${ANSI.red}\u274c Security: ${secSummary}${ANSI.reset}  ${elapsed}`);
      }
      break;
    }

    case "solomon:start":
      console.log(`  \u251c\u2500 ${icon} Solomon arbitrating ${event.detail?.conflictStage || "?"} conflict...`);
      break;

    case "solomon:end": {
      const ruling = event.detail?.ruling || "unknown";
      const rulingUpper = ruling.toUpperCase().replace(/_/g, " ");
      if (ruling === "approve") {
        const dismissedCount = event.detail?.dismissed?.length || 0;
        console.log(`  \u251c\u2500 ${ANSI.green}\u2696\ufe0f Solomon: APPROVE${dismissedCount > 0 ? ` (${dismissedCount} dismissed)` : ""}${ANSI.reset}  ${elapsed}`);
      } else if (ruling === "approve_with_conditions") {
        const condCount = event.detail?.conditions?.length || 0;
        console.log(`  \u251c\u2500 ${ANSI.yellow}\u2696\ufe0f Solomon: ${condCount} condition${condCount !== 1 ? "s" : ""}${ANSI.reset}  ${elapsed}`);
        if (event.detail?.conditions) {
          for (const cond of event.detail.conditions) {
            console.log(`  \u2502   ${ANSI.dim}${cond}${ANSI.reset}`);
          }
        }
      } else if (ruling === "escalate_human") {
        const reason = event.detail?.escalate_reason || "unknown reason";
        console.log(`  \u251c\u2500 ${ANSI.red}\u2696\ufe0f Solomon: ESCALATE \u2014 ${reason}${ANSI.reset}  ${elapsed}`);
      } else if (ruling === "create_subtask") {
        const subtaskTitle = event.detail?.subtask?.title || "untitled";
        console.log(`  \u251c\u2500 ${ANSI.magenta}\u2696\ufe0f Solomon: SUBTASK \u2014 ${subtaskTitle}${ANSI.reset}  ${elapsed}`);
      } else {
        console.log(`  \u251c\u2500 \u2696\ufe0f Solomon: ${rulingUpper}  ${elapsed}`);
      }
      break;
    }

    case "solomon:escalate": {
      const subloop = event.detail?.subloop || "?";
      const retryCount = event.detail?.retryCount || 0;
      const limit = event.detail?.limit || "?";
      console.log(`  \u251c\u2500 ${icon} ${subloop} sub-loop limit reached (${retryCount}/${limit}), invoking Solomon...`);
      break;
    }

    case "iteration:end":
      console.log(`  \u2514\u2500 ${icon} Duration: ${formatElapsed(event.detail?.duration)}  ${elapsed}`);
      break;

    case "session:end": {
      console.log();
      const resultLabel = event.detail?.approved
        ? `${ANSI.bold}${ANSI.green}APPROVED${ANSI.reset}`
        : `${ANSI.bold}${ANSI.red}${event.detail?.reason || "FAILED"}${ANSI.reset}`;
      console.log(`${icon} Result: ${resultLabel}  ${elapsed}`);

      const stages = event.detail?.stages;
      if (stages) {
        if (stages.researcher?.summary) {
          console.log(`  ${ANSI.dim}\ud83d\udd2c Research: ${stages.researcher.summary}${ANSI.reset}`);
        }
        if (stages.tester?.summary) {
          console.log(`  ${ANSI.dim}\ud83e\uddea Tester: ${stages.tester.summary}${ANSI.reset}`);
        }
        if (stages.security?.summary) {
          console.log(`  ${ANSI.dim}\ud83d\udd12 Security: ${stages.security.summary}${ANSI.reset}`);
        }
        if (stages.sonar) {
          const gateLabel = stages.sonar.gateStatus === "OK" ? ANSI.green : ANSI.red;
          console.log(`  ${ANSI.dim}\ud83d\udd0d Sonar: ${gateLabel}${stages.sonar.gateStatus}${ANSI.reset}${ANSI.dim} (${stages.sonar.openIssues ?? 0} issues)${ANSI.reset}`);
        }
      }

      const git = event.detail?.git;
      if (git?.branch) {
        const parts = [`branch: ${git.branch}`];
        if (git.committed) parts.push("committed");
        if (git.pushed) parts.push("pushed");
        if (git.pr) parts.push(`PR: ${git.pr}`);
        console.log(`  ${ANSI.dim}\ud83d\udcce Git: ${parts.join(", ")}${ANSI.reset}`);
      }

      console.log(`${ANSI.dim}Session: ${event.sessionId}${ANSI.reset}`);
      break;
    }

    case "question":
      console.log();
      console.log(`${ANSI.bold}${ANSI.yellow}${icon} Paused - question:${ANSI.reset}`);
      console.log(`  ${event.detail?.question || event.message}`);
      console.log(`${ANSI.dim}Resume with: kj resume ${event.sessionId} --answer "<response>"${ANSI.reset}`);
      break;

    case "agent:output":
      console.log(`  \u2502 ${ANSI.dim}${event.message}${ANSI.reset}`);
      break;

    default:
      console.log(`  \u251c\u2500 ${icon} ${event.message || event.type}  ${elapsed}`);
  }
}

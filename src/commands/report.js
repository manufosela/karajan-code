import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "../utils/fs.js";
import { getSessionRoot } from "../utils/paths.js";

function parseBudgetFromActivityLog(logText) {
  if (!logText) {
    return { consumed_usd: null, limit_usd: null };
  }

  const regex = /Budget:\s*\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*\$([0-9]+(?:\.[0-9]+)?)/g;
  let match;
  let last = null;
  while ((match = regex.exec(logText)) !== null) {
    last = match;
  }

  if (!last) {
    return { consumed_usd: null, limit_usd: null };
  }

  return {
    consumed_usd: Number(last[1]),
    limit_usd: Number(last[2])
  };
}

function summarizeIterations(checkpoints = []) {
  const byIteration = new Map();
  for (const checkpoint of checkpoints) {
    const iteration = Number(checkpoint?.iteration);
    if (!Number.isFinite(iteration) || iteration <= 0) continue;

    if (!byIteration.has(iteration)) {
      byIteration.set(iteration, {
        iteration,
        coder_runs: 0,
        reviewer_attempts: 0,
        reviewer_approved: null
      });
    }

    const item = byIteration.get(iteration);
    if (checkpoint.stage === "coder") {
      item.coder_runs += 1;
    } else if (checkpoint.stage === "reviewer-attempt") {
      item.reviewer_attempts += 1;
    } else if (checkpoint.stage === "reviewer") {
      item.reviewer_approved = Boolean(checkpoint.approved);
    }
  }

  return [...byIteration.values()].sort((a, b) => a.iteration - b.iteration);
}

function summarizePlan(checkpoints = []) {
  const stages = checkpoints
    .map((checkpoint) => checkpoint.stage)
    .filter((stage) => typeof stage === "string" && stage.length > 0);

  const uniqueOrdered = [];
  for (const stage of stages) {
    if (uniqueOrdered[uniqueOrdered.length - 1] !== stage) {
      uniqueOrdered.push(stage);
    }
  }

  return uniqueOrdered;
}

function summarizeSonar(checkpoints = []) {
  const sonarPoints = checkpoints
    .filter((checkpoint) => checkpoint.stage === "sonar" && typeof checkpoint.open_issues === "number")
    .map((checkpoint) => checkpoint.open_issues);

  if (sonarPoints.length === 0) {
    return { initial: null, final: null, resolved: 0 };
  }

  const initial = sonarPoints[0];
  const final = sonarPoints[sonarPoints.length - 1];
  return {
    initial,
    final,
    resolved: Math.max(initial - final, 0)
  };
}

function summarizeCommits(session, checkpoints = []) {
  const idsFromSession = Array.isArray(session?.git?.commits)
    ? session.git.commits.filter((item) => typeof item === "string" && item.length > 0)
    : [];

  const idsFromCheckpoints = checkpoints
    .filter((checkpoint) => checkpoint.stage === "git-commit" && checkpoint.committed && checkpoint.commit)
    .map((checkpoint) => checkpoint.commit)
    .filter((item) => typeof item === "string" && item.length > 0);

  const ids = [...new Set([...idsFromSession, ...idsFromCheckpoints])];
  if (ids.length > 0) {
    return { count: ids.length, ids };
  }

  const committedCount = checkpoints.filter(
    (checkpoint) => checkpoint.stage === "git-commit" && checkpoint.committed
  ).length;

  return { count: committedCount, ids: [] };
}

async function readActivityLog(sessionDir) {
  const file = path.join(sessionDir, "activity.log");
  if (!(await exists(file))) {
    return "";
  }

  return fs.readFile(file, "utf8");
}

async function buildReport(dir, sessionId) {
  const sessionDir = path.join(dir, sessionId);
  const sessionFile = path.join(sessionDir, "session.json");
  if (!(await exists(sessionFile))) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const content = await fs.readFile(sessionFile, "utf8");
  const session = JSON.parse(content);
  const checkpoints = Array.isArray(session.checkpoints) ? session.checkpoints : [];
  const activityLog = await readActivityLog(sessionDir);

  const sonar = summarizeSonar(checkpoints);
  const budget = parseBudgetFromActivityLog(activityLog);
  const commits = summarizeCommits(session, checkpoints);

  return {
    session_id: session.id,
    task_description: session.task || "",
    plan_executed: summarizePlan(checkpoints),
    iterations: summarizeIterations(checkpoints),
    sonar_issues_resolved: {
      initial_open_issues: sonar.initial,
      final_open_issues: sonar.final,
      resolved: sonar.resolved
    },
    budget_consumed: budget,
    commits_generated: commits,
    status: session.status || "unknown"
  };
}

function printTextReport(report) {
  const budgetText =
    typeof report.budget_consumed?.consumed_usd === "number"
      ? `$${report.budget_consumed.consumed_usd.toFixed(2)}${
          typeof report.budget_consumed?.limit_usd === "number"
            ? ` / $${report.budget_consumed.limit_usd.toFixed(2)}`
            : ""
        }`
      : "N/A";

  const planText = report.plan_executed.length > 0 ? report.plan_executed.join(" -> ") : "N/A";
  const iterationText =
    report.iterations.length > 0
      ? report.iterations
          .map(
            (item) =>
              `#${item.iteration} coder=${item.coder_runs} reviewer_attempts=${item.reviewer_attempts} approved=${item.reviewer_approved}`
          )
          .join("\n")
      : "N/A";
  const commitsText =
    report.commits_generated.ids.length > 0
      ? `${report.commits_generated.count} (${report.commits_generated.ids.join(", ")})`
      : String(report.commits_generated.count);

  console.log(`Session: ${report.session_id}`);
  console.log(`Status: ${report.status}`);
  console.log("Task Description:");
  console.log(report.task_description || "N/A");
  console.log("Plan Executed:");
  console.log(planText);
  console.log("Iterations (Coder/Reviewer):");
  console.log(iterationText);
  console.log("Sonar Issues Resolved:");
  console.log(
    `initial=${report.sonar_issues_resolved.initial_open_issues ?? "N/A"} final=${report.sonar_issues_resolved.final_open_issues ?? "N/A"} resolved=${report.sonar_issues_resolved.resolved}`
  );
  console.log("Budget Consumed:");
  console.log(budgetText);
  console.log("Commits Generated:");
  console.log(commitsText);
}

export async function reportCommand({ list = false, sessionId = null, format = "text" }) {
  const dir = getSessionRoot();
  if (!(await exists(dir))) {
    console.log("No reports yet");
    return;
  }

  const entries = await fs.readdir(dir);
  if (list) {
    for (const item of entries) console.log(item);
    return;
  }

  const ids = [...entries].sort();
  const selectedSessionId = sessionId || ids.at(-1);
  if (!selectedSessionId) {
    console.log("No reports yet");
    return;
  }
  if (sessionId && !ids.includes(sessionId)) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const report = await buildReport(dir, selectedSessionId);
  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printTextReport(report);
}

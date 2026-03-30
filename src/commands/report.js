import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "../utils/fs.js";
import { getSessionRoot } from "../utils/paths.js";
import { loadConfig } from "../config.js";

function parseBudgetFromActivityLog(logText) {
  if (!logText) {
    return { consumed_usd: null, limit_usd: null };
  }

  const regex = /Budget:\s*\$(\d+(?:\.\d+)?)\s*\/\s*\$(\d+(?:\.\d+)?)/g;
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
    if (uniqueOrdered.at(-1) !== stage) {
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
  const final = sonarPoints.at(-1);
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

  const budgetTrace = Array.isArray(session.budget?.trace) ? session.budget.trace : [];

  const report = {
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
    budget_trace: budgetTrace,
    commits_generated: commits,
    status: session.status || "unknown"
  };
  if (session.pg_task_id) report.pg_task_id = session.pg_task_id;
  if (session.pg_project_id) report.pg_project_id = session.pg_project_id;
  return report;
}

function formatBudgetText(budget) {
  if (typeof budget?.consumed_usd !== "number") return "N/A";
  const limitSuffix = typeof budget.limit_usd === "number" ? ` / $${budget.limit_usd.toFixed(2)}` : "";
  return `$${budget.consumed_usd.toFixed(2)}${limitSuffix}`;
}

function formatIterationsText(iterations) {
  if (iterations.length === 0) return "N/A";
  return iterations
    .map((item) => `#${item.iteration} coder=${item.coder_runs} reviewer_attempts=${item.reviewer_attempts} approved=${item.reviewer_approved}`)
    .join("\n");
}

function formatCommitsText(commits) {
  return commits.ids.length > 0
    ? `${commits.count} (${commits.ids.join(", ")})`
    : String(commits.count);
}

function printPgCardLine(report) {
  if (!report.pg_task_id) return;
  const projectLabel = report.pg_project_id ? ` (${report.pg_project_id})` : "";
  console.log(`Planning Game Card: ${report.pg_task_id}${projectLabel}`);
}

function printTextReport(report) {
  const sonar = report.sonar_issues_resolved;

  console.log(`Session: ${report.session_id}`);
  printPgCardLine(report);
  console.log(`Status: ${report.status}`);
  console.log("Task Description:");
  console.log(report.task_description || "N/A");
  console.log("Plan Executed:");
  console.log(report.plan_executed.length > 0 ? report.plan_executed.join(" -> ") : "N/A");
  console.log("Iterations (Coder/Reviewer):");
  console.log(formatIterationsText(report.iterations));
  console.log("Sonar Issues Resolved:");
  console.log(`initial=${sonar.initial_open_issues ?? "N/A"} final=${sonar.final_open_issues ?? "N/A"} resolved=${sonar.resolved}`);
  console.log("Budget Consumed:");
  console.log(formatBudgetText(report.budget_consumed));
  console.log("Commits Generated:");
  console.log(formatCommitsText(report.commits_generated));
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m${remainSeconds}s`;
}

function padRight(str, len) {
  const s = String(str);
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(str, len) {
  const s = String(str);
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function convertCost(costUsd, currency, exchangeRate) {
  if (currency === "eur") return costUsd * exchangeRate;
  return costUsd;
}

function formatCost(cost, currency) {
  const symbol = currency === "eur" ? "\u20AC" : "$";
  return `${symbol}${cost.toFixed(4)}`;
}

function printTraceTable(trace, { currency = "usd", exchangeRate = 0.92 } = {}) {
  if (!trace || trace.length === 0) {
    console.log("No trace data available.");
    return;
  }

  const currencyLabel = currency.toUpperCase();

  const headers = ["#", "Stage", "Provider", "Model", "Duration", "Tokens In", "Tokens Out", `Cost ${currencyLabel}`];
  const rows = trace.map((entry) => {
    const cost = convertCost(entry.cost_usd, currency, exchangeRate);
    return [
      String(entry.index ?? "-"),
      entry.role,
      entry.provider || "-",
      entry.model || "-",
      formatDuration(entry.duration_ms),
      String(entry.tokens_in),
      String(entry.tokens_out),
      formatCost(cost, currency)
    ];
  });

  const totals = trace.reduce(
    (acc, entry) => {
      acc.tokens_in += entry.tokens_in;
      acc.tokens_out += entry.tokens_out;
      acc.cost += entry.cost_usd;
      acc.duration += entry.duration_ms ?? 0;
      return acc;
    },
    { tokens_in: 0, tokens_out: 0, cost: 0, duration: 0 }
  );

  const totalRow = [
    "",
    "TOTAL",
    "",
    "",
    formatDuration(totals.duration),
    String(totals.tokens_in),
    String(totals.tokens_out),
    formatCost(convertCost(totals.cost, currency, exchangeRate), currency)
  ];

  const allRows = [headers, ...rows, totalRow];
  const colWidths = headers.map((_, colIdx) =>
    Math.max(...allRows.map((row) => String(row[colIdx]).length))
  );

  const rightAligned = new Set([0, 4, 5, 6, 7]);
  function formatRow(row) {
    return row
      .map((cell, idx) =>
        rightAligned.has(idx)
          ? padLeft(cell, colWidths[idx])
          : padRight(cell, colWidths[idx])
      )
      .join("  ");
  }

  console.log(formatRow(headers));
  console.log(colWidths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log(colWidths.map((w) => "-".repeat(w)).join("  "));
  console.log(formatRow(totalRow));
}

async function findSessionsByPgTask(dir, pgTask) {
  const entries = await fs.readdir(dir);
  const matches = [];
  for (const entry of entries) {
    const sessionFile = path.join(dir, entry, "session.json");
    if (!(await exists(sessionFile))) continue;
    try {
      const raw = await fs.readFile(sessionFile, "utf8");
      const session = JSON.parse(raw);
      if (session.pg_task_id === pgTask) {
        matches.push(entry);
      }
    } catch { /* skip malformed session files */
      // skip malformed sessions
    }
  }
  return matches.sort((a, b) => a.localeCompare(b));
}

async function resolveTraceOptions(currency) {
  const { config } = await loadConfig();
  const cur = currency?.toLowerCase() || config?.budget?.currency || "usd";
  const rate = config?.budget?.exchange_rate_eur ?? 0.92;
  return { cur, rate };
}

function printTraceReport(report, currency, exchangeRate) {
  console.log(`Session: ${report.session_id}`);
  printPgCardLine(report);
  console.log(`Status: ${report.status}`);
  console.log(`Task: ${report.task_description || "N/A"}`);
  console.log("");
  printTraceTable(report.budget_trace, { currency, exchangeRate });
}

async function handlePgTaskReport({ dir, pgTask, list, sessionId, format, trace, currency }) {
  const matches = await findSessionsByPgTask(dir, pgTask);
  if (matches.length === 0) {
    console.log(`No sessions found for card: ${pgTask}`);
    return;
  }
  if (list) {
    for (const item of matches) console.log(item);
    return;
  }
  const targetId = sessionId || matches.at(-1);
  const report = await buildReport(dir, targetId);
  if (format === "json") {
    console.log(JSON.stringify({ card: pgTask, sessions: matches, report }, null, 2));
    return;
  }
  console.log(`Card ${pgTask}: ${matches.length} session${matches.length === 1 ? "" : "s"}`);
  for (const m of matches) {
    const marker = m === targetId ? " <--" : "";
    console.log(`  ${m}${marker}`);
  }
  console.log("");
  if (trace) {
    const { cur, rate } = await resolveTraceOptions(currency);
    printTraceReport(report, cur, rate);
  } else {
    printTextReport(report);
  }
}

async function handleSingleSessionReport({ dir, entries, sessionId, format, trace, currency }) {
  const ids = [...entries].sort((a, b) => a.localeCompare(b));
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
  if (trace) {
    const { cur, rate } = await resolveTraceOptions(currency);
    printTraceReport(report, cur, rate);
    return;
  }
  printTextReport(report);
}

export async function reportCommand({ list = false, sessionId = null, format = "text", trace = false, currency = "usd", pgTask = null }) {
  const dir = getSessionRoot();
  if (!(await exists(dir))) {
    console.log("No reports yet");
    return;
  }

  const entries = await fs.readdir(dir);

  if (pgTask) {
    return handlePgTaskReport({ dir, pgTask, list, sessionId, format, trace, currency });
  }

  if (list) {
    for (const item of entries) console.log(item);
    return;
  }

  return handleSingleSessionReport({ dir, entries, sessionId, format, trace, currency });
}

export { formatDuration, convertCost, formatCost, printTraceTable, buildReport, findSessionsByPgTask };

// Session Journal: persists structured stage outputs and generates summaries.
// Creates .reviews/session_*/ directories containing markdown files per stage.
import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/process.js";

/**
 * Create the journal directory for a session.
 * @param {string} reportDir -base directory (e.g. ".reviews")
 * @param {string} sessionId
 * @returns {Promise<string>} absolute path to the journal directory
 */
export async function createJournalDir(reportDir, sessionId) {
  const journalDir = path.resolve(reportDir, sessionId);
  await fs.mkdir(journalDir, { recursive: true });
  return journalDir;
}

/**
 * Write a markdown file to the journal directory.
 * Only writes if content is non-empty. Skips silently otherwise.
 */
async function writeJournalFile(journalDir, filename, content) {
  if (!content || !journalDir) return;
  const filePath = path.join(journalDir, filename);
  await fs.writeFile(filePath, content, "utf8");
}

// ── Stage serializers ────────────────────────────────────────────────────────

function serializeDiscovery(stageResult) {
  if (!stageResult) return null;
  const lines = ["# Discovery\n"];
  lines.push(`**Verdict**: ${stageResult.verdict || "N/A"}`);
  lines.push(`**Mode**: ${stageResult.mode || "gaps"}\n`);

  const gaps = stageResult.gaps || [];
  if (gaps.length) {
    lines.push("## Gaps Found\n");
    for (const gap of gaps) {
      const severity = gap.severity ? ` [${gap.severity}]` : "";
      lines.push(`- ${gap.title || gap.description || gap}${severity}`);
    }
  }

  if (stageResult.momTestQuestions?.length) {
    lines.push("\n## Mom Test Questions\n");
    for (const q of stageResult.momTestQuestions) lines.push(`- ${q}`);
  }
  if (stageResult.wendelChecklist?.length) {
    lines.push("\n## Wendel Checklist\n");
    for (const item of stageResult.wendelChecklist) lines.push(`- [${item.status}] ${item.condition}`);
  }

  return lines.join("\n");
}

function serializeResearch(stageResult) {
  if (!stageResult) return null;
  const lines = ["# Research\n"];

  const sections = [
    { key: "affected_files", title: "Affected Files" },
    { key: "patterns", title: "Patterns" },
    { key: "constraints", title: "Constraints" },
    { key: "risks", title: "Risks" },
    { key: "prior_decisions", title: "Prior Decisions" }
  ];

  for (const { key, title } of sections) {
    const items = stageResult[key];
    if (items?.length) {
      lines.push(`## ${title}\n`);
      for (const item of items) lines.push(`- ${item}`);
      lines.push("");
    }
  }

  if (stageResult.test_coverage) {
    lines.push(`## Test Coverage\n\n${stageResult.test_coverage}`);
  }

  return lines.join("\n");
}

function serializeArchitecture(stageResult) {
  if (!stageResult) return null;
  const lines = ["# Architecture\n"];
  lines.push(`**Verdict**: ${stageResult.verdict || "N/A"}\n`);

  const arch = stageResult.architecture || {};
  if (arch.type) lines.push(`**Type**: ${arch.type}\n`);
  if (arch.layers?.length) {
    lines.push("## Layers\n");
    for (const l of arch.layers) lines.push(`- ${l}`);
    lines.push("");
  }
  if (arch.patterns?.length) {
    lines.push("## Patterns\n");
    for (const p of arch.patterns) lines.push(`- ${p}`);
    lines.push("");
  }
  if (arch.dataModel?.entities?.length) {
    lines.push("## Data Model\n");
    for (const e of arch.dataModel.entities) lines.push(`- ${typeof e === "string" ? e : e.name || JSON.stringify(e)}`);
    lines.push("");
  }
  if (arch.apiContracts?.length) {
    lines.push("## API Contracts\n");
    for (const a of arch.apiContracts) lines.push(`- ${typeof a === "string" ? a : JSON.stringify(a)}`);
    lines.push("");
  }
  if (arch.tradeoffs?.length) {
    lines.push("## Tradeoffs\n");
    for (const t of arch.tradeoffs) lines.push(`- ${t}`);
  }
  if (stageResult.questions?.length) {
    lines.push("\n## Open Questions\n");
    for (const q of stageResult.questions) lines.push(`- ${q}`);
  }

  return lines.join("\n");
}

function serializePlan(stageResult) {
  if (!stageResult?.plan) return null;
  return `# Implementation Plan\n\n${stageResult.plan}`;
}

function serializeTriage(stageResult) {
  if (!stageResult) return null;
  const lines = ["# Triage\n"];
  lines.push(`**Level**: ${stageResult.level || "N/A"}`);
  lines.push(`**Task Type**: ${stageResult.taskType || "N/A"}`);
  lines.push(`**Roles**: ${(stageResult.roles || []).join(", ") || "none"}`);
  if (stageResult.reasoning) lines.push(`\n**Reasoning**: ${stageResult.reasoning}`);
  if (stageResult.shouldDecompose) {
    lines.push("\n## Decomposition\n");
    for (const sub of stageResult.subtasks || []) lines.push(`- ${sub}`);
  }
  return lines.join("\n");
}

// ── Iteration log ────────────────────────────────────────────────────────────

/**
 * Append one iteration entry to the iterations buffer.
 * Called after each iteration completes.
 */
export function formatIteration({ iteration, coderSummary, reviewerSummary, sonarSummary, solomonRuling, testerSummary, securitySummary, durationMs }) {
  const lines = [`## Iteration ${iteration}\n`];
  lines.push(`**Duration**: ${Math.round((durationMs || 0) / 1000)}s\n`);

  if (coderSummary) lines.push(`**Coder**: ${coderSummary}`);
  if (reviewerSummary) lines.push(`**Reviewer**: ${reviewerSummary}`);
  if (sonarSummary) lines.push(`**Sonar**: ${sonarSummary}`);
  if (testerSummary) lines.push(`**Tester**: ${testerSummary}`);
  if (securitySummary) lines.push(`**Security**: ${securitySummary}`);
  if (solomonRuling) lines.push(`**Solomon**: ${solomonRuling}`);

  lines.push("");
  return lines.join("\n");
}

// ── Decisions log ────────────────────────────────────────────────────────────

export function formatDecision({ timestamp, trigger, context, action, reasoning }) {
  const lines = [`## ${timestamp || new Date().toISOString()}\n`];
  lines.push(`**Trigger**: ${trigger}`);
  if (context) lines.push(`**Context**: ${context}`);
  lines.push(`**Action**: ${action}`);
  if (reasoning) lines.push(`**Reasoning**: ${reasoning}`);
  lines.push("");
  return lines.join("\n");
}

// ── Tree of affected files ───────────────────────────────────────────────────

export async function generateFileTree(baseRef) {
  try {
    const result = await runCommand("git", ["diff", "--name-status", `${baseRef}...HEAD`]);
    if (result.exitCode !== 0 || !result.stdout?.trim()) return null;

    const lines = ["# Affected Files\n"];
    const statusMap = { M: "modified", A: "added", D: "deleted", R: "renamed" };

    for (const line of result.stdout.trim().split("\n")) {
      const [status, ...fileParts] = line.split("\t");
      const file = fileParts.join("\t");
      const label = statusMap[status?.[0]] || status;
      lines.push(`- [${label}] ${file}`);
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function generateSummary({ task, result, sessionId, iterations, durationMs, budget, stages, commits, files }) {
  const lines = ["# Session Summary\n"];
  lines.push(`**Session**: ${sessionId}`);
  lines.push(`**Task**: ${task}`);
  lines.push(`**Result**: ${result}`);
  lines.push(`**Iterations**: ${iterations}`);
  lines.push(`**Duration**: ${Math.round((durationMs || 0) / 1000)}s`);

  if (budget) {
    lines.push(`**Budget**: ~$${budget.total_cost_usd?.toFixed(2) || "?"} / ~${budget.total_tokens?.toLocaleString() || "?"} tokens`);
  }

  if (stages && Object.keys(stages).length) {
    lines.push("\n## Stages Executed\n");
    for (const [name, stageResult] of Object.entries(stages)) {
      const status = stageResult?.ok !== false ? "pass" : "fail";
      const summary = stageResult?.summary || "";
      lines.push(`- **${name}**: ${status}${summary ? ` -${summary}` : ""}`);
    }
  }

  if (commits?.length) {
    lines.push("\n## Commits\n");
    for (const c of commits) lines.push(`- \`${(c.hash || "").slice(0, 7)}\` ${c.message || ""}`);
  }

  // List journal files
  lines.push("\n## Journal Files\n");
  for (const f of files) lines.push(`- [${f}](./${f})`);

  return lines.join("\n");
}

// ── Pipeline plan display ────────────────────────────────────────────────────

/**
 * Build a console-friendly pipeline plan summary.
 * Shown before the iteration loop starts.
 */
export function buildPlanSummary({ pipelineFlags, config, stageResults, task }) {
  const lines = [];
  lines.push("┌─ Pipeline Plan ─────────────────────────────");

  // Task (truncated)
  const taskPreview = task.length > 80 ? task.slice(0, 77) + "..." : task;
  lines.push(`│ Task: ${taskPreview}`);

  // Triage result
  const triage = stageResults?.triage;
  if (triage) {
    lines.push(`│ Triage: ${triage.level} (${triage.taskType || "sw"}) → roles: ${(triage.roles || []).join(", ")}`);
  }

  // Active stages
  const activeStages = [];
  if (pipelineFlags.researcherEnabled) activeStages.push("Researcher");
  if (pipelineFlags.architectEnabled) activeStages.push("Architect");
  if (pipelineFlags.plannerEnabled) activeStages.push("Planner");
  activeStages.push("Coder");
  if (pipelineFlags.refactorerEnabled) activeStages.push("Refactorer");
  if (pipelineFlags.reviewerEnabled) activeStages.push("Reviewer");
  if (pipelineFlags.testerEnabled) activeStages.push("Tester");
  if (pipelineFlags.securityEnabled) activeStages.push("Security");
  if (pipelineFlags.impeccableEnabled) activeStages.push("Impeccable");
  lines.push(`│ Stages: ${activeStages.join(" → ")}`);

  // Config
  const methodology = config.development?.methodology || "standard";
  const maxIter = config.max_iterations || 5;
  const solomonOn = config.pipeline?.solomon?.enabled !== false;
  lines.push(`│ Method: ${methodology} | Max iterations: ${maxIter} | Solomon: ${solomonOn ? "on" : "off"}`);

  // Plan summary (if planner ran)
  const plan = stageResults?.planner;
  if (plan?.plan) {
    const planLines = plan.plan.split("\n").filter(l => l.trim());
    const preview = planLines.slice(0, 5);
    lines.push("│");
    lines.push("│ Plan:");
    for (const pl of preview) lines.push(`│   ${pl}`);
    if (planLines.length > 5) lines.push(`│   ... (${planLines.length - 5} more steps)`);
  }

  lines.push("└──────────────────────────────────────────────");
  return lines.join("\n");
}

// ── Main write functions ─────────────────────────────────────────────────────

/**
 * Write all pre-loop stage outputs to the journal.
 */
export async function writePreLoopJournal(journalDir, stageResults) {
  const writes = [
    { file: "triage.md", content: serializeTriage(stageResults.triage) },
    { file: "discovery.md", content: serializeDiscovery(stageResults.discover) },
    { file: "research.md", content: serializeResearch(stageResults.researcher) },
    { file: "architecture.md", content: serializeArchitecture(stageResults.architect) },
    { file: "plan.md", content: serializePlan(stageResults.planner) }
  ];

  await Promise.all(
    writes.filter(w => w.content).map(w => writeJournalFile(journalDir, w.file, w.content))
  );

  return writes.filter(w => w.content).map(w => w.file);
}

/**
 * Write the iterations log.
 */
export async function writeIterationsJournal(journalDir, iterationEntries) {
  if (!iterationEntries?.length) return;
  const content = "# Iterations\n\n" + iterationEntries.join("\n");
  await writeJournalFile(journalDir, "iterations.md", content);
}

/**
 * Write the decisions log.
 */
export async function writeDecisionsJournal(journalDir, decisionEntries) {
  if (!decisionEntries?.length) return;
  const content = "# Solomon Decisions\n\n" + decisionEntries.join("\n");
  await writeJournalFile(journalDir, "decisions.md", content);
}

/**
 * Write the file tree.
 */
export async function writeTreeJournal(journalDir, baseRef) {
  const tree = await generateFileTree(baseRef);
  if (tree) await writeJournalFile(journalDir, "tree.txt", tree);
  return Boolean(tree);
}

/**
 * Write the session summary.
 */
export async function writeSummaryJournal(journalDir, summaryData) {
  const files = summaryData.files || [];
  const content = generateSummary({ ...summaryData, files: [...files, "summary.md"] });
  await writeJournalFile(journalDir, "summary.md", content);
}

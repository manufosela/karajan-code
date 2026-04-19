/**
 * Executive session summary (`summary.md`) — the entry point to the journal
 * directory. Pulls together every useful signal from the session into a
 * single scannable Markdown page with links to the rest of the journal.
 *
 * Acceptance criterion (KJC-TSK-0289):
 *   summary.md contains: task, result (approved/rejected/paused), iterations,
 *   duration, budget, stages + status, list of journal files, commits.
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {Object} SummaryInput
 * @property {string} sessionId
 * @property {string} task
 * @property {"APPROVED"|"REJECTED"|"PAUSED"|"FAILED"|string} result
 * @property {number} iterations
 * @property {number} durationMs
 * @property {{ total_cost_usd?: number, total_tokens?: number, breakdown_by_role?: Object }} [budget]
 * @property {Record<string, { ok?: boolean, summary?: string }>} [stages]
 * @property {Array<{ hash?: string, message?: string, date?: string, author?: string }>} [commits]
 * @property {string[]} [files]                    - names of other journal files in the same dir
 * @property {string} [startedAt]                  - ISO timestamp (optional, auto-derived if absent)
 * @property {string} [finishedAt]                 - ISO timestamp (optional)
 * @property {number} [solomonInvocations]
 * @property {number} [brainDecisions]
 */

function esc(text) {
  return String(text ?? "").replace(/\|/g, "\\|");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m ${rs}s`;
}

function formatBudget(budget) {
  if (!budget) return "—";
  const cost = Number(budget.total_cost_usd ?? 0);
  const tokens = Number(budget.total_tokens ?? 0);
  const costStr = `$${cost.toFixed(2)}`;
  const tokStr = tokens > 0 ? `${tokens.toLocaleString("en-US")} tokens` : "—";
  return `${costStr} · ${tokStr}`;
}

function resultBadge(result) {
  const r = String(result || "").toUpperCase();
  const map = {
    APPROVED: "✅ APPROVED",
    REJECTED: "❌ REJECTED",
    PAUSED: "⏸ PAUSED",
    FAILED: "❌ FAILED",
  };
  return map[r] || r;
}

function renderStagesTable(stages) {
  if (!stages || Object.keys(stages).length === 0) return "_No stages recorded._";
  const header = "| Stage | Status | Summary |\n|---|---|---|";
  const rows = Object.entries(stages).map(([name, stageResult]) => {
    const ok = stageResult?.ok !== false;
    const status = ok ? "✅ pass" : "❌ fail";
    const summary = esc(stageResult?.summary || "").slice(0, 120);
    return `| \`${esc(name)}\` | ${status} | ${summary} |`;
  });
  return [header, ...rows].join("\n");
}

function renderCommits(commits) {
  if (!Array.isArray(commits) || commits.length === 0) return "_No commits in this session._";
  return commits
    .map((c) => {
      const hash = (c.hash || "").slice(0, 7) || "?";
      return `- \`${hash}\` ${esc(c.message || "(no message)")}`;
    })
    .join("\n");
}

function renderBreakdownByRole(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return null;
  const entries = Object.entries(breakdown)
    .map(([role, m]) => ({
      role,
      tokens: Number(m?.total_tokens || 0),
      cost: Number(m?.total_cost_usd || 0),
    }))
    .filter((e) => e.tokens > 0 || e.cost > 0);
  if (entries.length === 0) return null;
  const rows = entries
    .sort((a, b) => b.cost - a.cost)
    .map((e) => `| \`${esc(e.role)}\` | ${e.tokens.toLocaleString("en-US")} | $${e.cost.toFixed(4)} |`);
  return ["| Role | Tokens | Cost |", "|---|---|---|", ...rows].join("\n");
}

function renderJournalLinks(files) {
  if (!Array.isArray(files) || files.length === 0) return "_No additional journal files._";
  return files.map((f) => `- [${esc(f)}](./${f})`).join("\n");
}

/**
 * Build the summary.md content.
 *
 * @param {SummaryInput} input
 * @returns {string}
 */
export function buildSummaryMarkdown(input) {
  const sessionId = input.sessionId || "(unknown)";
  const result = resultBadge(input.result);
  const startedAt = input.startedAt || "(unknown)";
  const finishedAt = input.finishedAt || new Date().toISOString();

  const sections = [
    `# Session summary — ${sessionId}`,
    "",
    `- **Result**: ${result}`,
    `- **Task**: ${esc(input.task || "(no task)")}`,
    `- **Iterations**: ${input.iterations ?? 0}`,
    `- **Duration**: ${formatDuration(input.durationMs)}`,
    `- **Budget**: ${formatBudget(input.budget)}`,
    `- **Started**: ${startedAt}`,
    `- **Finished**: ${finishedAt}`,
  ];

  if (Number.isFinite(input.brainDecisions) && input.brainDecisions > 0) {
    sections.push(`- **Brain decisions**: ${input.brainDecisions}`);
  }
  if (Number.isFinite(input.solomonInvocations) && input.solomonInvocations > 0) {
    sections.push(`- **Solomon invocations**: ${input.solomonInvocations}`);
  }

  sections.push("", "---", "", "## Stages", "", renderStagesTable(input.stages));

  const breakdown = renderBreakdownByRole(input.budget?.breakdown_by_role);
  if (breakdown) {
    sections.push("", "## Budget breakdown (by role)", "", breakdown);
  }

  sections.push("", "## Commits", "", renderCommits(input.commits));

  sections.push("", "## Journal files", "", renderJournalLinks(input.files));

  return sections.join("\n") + "\n";
}

/**
 * Write summary.md to the given journal directory. Always writes (the file
 * is the entry point; even a barebones session should have one).
 *
 * @param {string} journalDir
 * @param {SummaryInput} input
 * @param {{ logger?: Object }} [options]
 * @returns {Promise<{ written: boolean, path: string|null }>}
 */
export async function writeSummaryJournal(journalDir, input, options = {}) {
  const filePath = path.join(journalDir, "summary.md");
  try {
    await fs.mkdir(journalDir, { recursive: true });
    await fs.writeFile(filePath, buildSummaryMarkdown(input), "utf8");
    options.logger?.info?.(`Wrote session summary: ${filePath}`);
    return { written: true, path: filePath };
  } catch (err) {
    options.logger?.warn?.(`Failed to write session summary (non-blocking): ${err.message}`);
    return { written: false, path: null };
  }
}

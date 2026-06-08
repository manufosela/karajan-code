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
 * @property {{ total_cost_usd?: number, total_tokens?: number, total_cached_tokens?: number, breakdown_by_role?: Object }} [budget]
 * @property {Record<string, { ok?: boolean, summary?: string }>} [stages]
 * @property {Array<{ hash?: string, message?: string, date?: string, author?: string }>} [commits]
 * @property {string[]} [files]                    - names of other journal files in the same dir
 * @property {string} [startedAt]                  - ISO timestamp (optional, auto-derived if absent)
 * @property {string} [finishedAt]                 - ISO timestamp (optional)
 * @property {number} [solomonInvocations]
 * @property {number} [brainDecisions]
 * @property {Object} [skills]                        - skill sources used this session (KJC-TSK-0327)
 * @property {Object} [skills.addyosmani]             - { available, action, resolvedSlugs, reason }
 * @property {string[]} [skills.installed]            - OpenSkills installed this run (session.autoInstalledSkills)
 * @property {string[]} [skills.recommended]          - wouldHaveUsed when OpenSkills CLI missing
 */

function esc(text) {
  return String(text ?? "").replaceAll(/\|/g, "\\|");
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

/**
 * Render the Cache hits section (Φ0-F, KJC-TSK-0524). Shows how many input
 * tokens were served from provider-side prompt caches, per role, plus a
 * conservative dollar savings estimate.
 *
 * Savings formula: cached tokens are billed at ~10% of the input rate (the
 * Anthropic/OpenAI convention). Per role:
 *   savings_usd ≈ cost_usd * (cached_tokens / tokens_in) * 0.9
 * The estimate is approximate (output tokens also contribute to cost_usd)
 * and labelled with `~$` so users don't read it as exact.
 *
 * Returns:
 *   - null when no budget data is available
 *   - "cold run" placeholder when cached == 0 across all roles
 *   - Markdown table sorted by cached tokens desc when there is cache activity
 */
function renderCacheHits(budget) {
  if (!budget) return null;
  const totalCached = Number(budget.total_cached_tokens ?? 0);
  const breakdown = budget.breakdown_by_role || {};
  const entries = Object.entries(breakdown)
    .map(([role, m]) => ({
      role,
      cached: Number(m?.cached_tokens || 0),
      tokens_in: Number(m?.tokens_in || 0),
      cost: Number(m?.total_cost_usd || 0),
    }))
    .filter((e) => e.cached > 0);

  if (totalCached === 0 && entries.length === 0) {
    return "_Cache hits: 0 tokens (cold run)._";
  }

  const rows = entries
    .sort((a, b) => b.cached - a.cached)
    .map((e) => {
      const ratio = e.tokens_in > 0 ? (e.cached / e.tokens_in) * 100 : 0;
      const savings = e.tokens_in > 0 ? e.cost * (e.cached / e.tokens_in) * 0.9 : 0;
      return `| \`${esc(e.role)}\` | ${e.cached.toLocaleString("en-US")} | ${ratio.toFixed(1)}% | ~$${savings.toFixed(4)} |`;
    });
  const header = "| Role | Cached tokens | Ratio (cached/in) | Est. savings |\n|---|---|---|---|";
  return [
    `**Total cached**: ${totalCached.toLocaleString("en-US")} tokens`,
    "",
    header,
    ...rows,
  ].join("\n");
}

/**
 * Render the Skills section: which process skills (addyosmani) were resolved
 * for the task, which OpenSkills were installed, and which skills would have
 * helped but couldn't be installed (graceful-degradation path).
 *
 * Returns null when no skill activity happened (no addyosmani, no installs,
 * no recommendations) so the section is elided.
 */
function renderSkills(skills) {
  if (!skills || typeof skills !== "object") return null;
  const addy = skills.addyosmani;
  const installed = Array.isArray(skills.installed) ? skills.installed : [];
  const recommended = Array.isArray(skills.recommended) ? skills.recommended : [];

  const hasAddy = addy && (addy.available === true || addy.available === false);
  if (!hasAddy && installed.length === 0 && recommended.length === 0) return null;

  const lines = [];

  if (hasAddy) {
    if (addy.available) {
      const action = addy.action || "ready";
      const slugs = Array.isArray(addy.resolvedSlugs) ? addy.resolvedSlugs : [];
      lines.push(`- **addyosmani/agent-skills** (process, 1st source): ${esc(action)}` +
        (slugs.length > 0 ? ` — resolved slugs: ${slugs.map((s) => `\`${esc(s)}\``).join(", ")}` : " — no role/task-specific slugs resolved"));
    } else {
      const reason = addy.reason ? ` — ${esc(addy.reason)}` : "";
      lines.push(`- **addyosmani/agent-skills**: unavailable${reason}`);
    }
  }

  if (installed.length > 0) {
    lines.push(`- **OpenSkills installed**: ${installed.map((s) => `\`${esc(s)}\``).join(", ")}`);
  }

  if (recommended.length > 0) {
    lines.push(`- **OpenSkills recommended** (CLI missing, would-have-used): ${recommended.map((s) => `\`${esc(s)}\``).join(", ")}`);
  }

  return lines.join("\n");
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

  const cacheHitsSection = renderCacheHits(input.budget);
  if (cacheHitsSection) {
    sections.push("", "## Cache hits", "", cacheHitsSection);
  }

  const skillsSection = renderSkills(input.skills);
  if (skillsSection) {
    sections.push("", "## Skills Used", "", skillsSection);
  }

  sections.push("", "## Commits", "", renderCommits(input.commits));

  // KJC-TSK-0376 — plan adherence metric (deepeval-inspired). Only
  // rendered when the run executed against a known plan and the
  // calculation produced a non-null score (a run with no commits or
  // no files changed yields nulls everywhere → omit the section).
  const planAdherenceSection = renderPlanAdherence(input.planAdherence);
  if (planAdherenceSection) {
    sections.push("", "## Plan adherence", "", planAdherenceSection);
  }

  sections.push("", "## Journal files", "", renderJournalLinks(input.files));

  return sections.join("\n") + "\n";
}

function renderPlanAdherence(planAdherence) {
  if (!planAdherence || typeof planAdherence !== "object") return "";
  if (planAdherence.score === null || planAdherence.score === undefined) return "";
  const lines = [`**Score**: ${planAdherence.score}/100`, ""];
  const breakdown = planAdherence.breakdown || {};
  lines.push("| Component | Score | Weight |");
  lines.push("| --- | --- | --- |");
  const rows = [
    ["Commit attribution", breakdown.commit_attribution, "40%"],
    ["Acceptance tests",   breakdown.acceptance_tests,   "30%"],
    ["Scope discipline",   breakdown.scope_discipline,   "20%"],
    ["Dependency order",   breakdown.dependency_order,   "10%"],
  ];
  for (const [label, value, weight] of rows) {
    const cell = value === null || value === undefined ? "n/a" : `${value}/100`;
    lines.push(`| ${label} | ${cell} | ${weight} |`);
  }
  const huScores = Array.isArray(planAdherence.hu_scores) ? planAdherence.hu_scores : [];
  if (huScores.length > 0) {
    const unattributed = huScores.filter((h) => !h.attributed);
    if (unattributed.length > 0) {
      lines.push("", `_${unattributed.length} HU(s) without an attributed commit:_`);
      for (const h of unattributed) {
        lines.push(`- \`${h.huId}\``);
      }
    }
  }
  return lines.join("\n");
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

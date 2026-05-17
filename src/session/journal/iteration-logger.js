/**
 * Per-iteration journal entries for `.reviews/{sessionId}/iterations.md`.
 *
 * The orchestrator calls `recordIteration(session, data)` after every
 * iteration of the coder/reviewer loop completes. Entries are appended to
 * `session._journalIterations` and rendered as Markdown at session end.
 *
 * Acceptance criterion (KJC-TSK-0287):
 *   - Given a kj run with multiple iterations → iterations.md exists with
 *     one section per iteration containing: number, coder summary, reviewer
 *     blocking issues, sonar issues (if any), Solomon ruling (if any),
 *     duration.
 */

/**
 * @typedef {Object} IterationData
 * @property {number} iteration                                  - 1-based index
 * @property {number} durationMs
 * @property {string} [coderSummary]
 * @property {string} [reviewerSummary]
 * @property {Array<{id?:string, severity?:string, file?:string, line?:number, description?:string}>} [blockingIssues]
 * @property {string} [sonarSummary]
 * @property {number} [sonarIssuesFound]
 * @property {number} [sonarIssuesResolved]
 * @property {string} [testerSummary]
 * @property {string} [securitySummary]
 * @property {{ ruling?:string, reasoning?:string }} [solomon]   - only present when Solomon ran in this iteration
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
  return `${m}m ${rs}s`;
}

function formatBlockingIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const lines = ["**Blocking issues**:"];
  for (const issue of issues) {
    const sev = issue.severity ? `[${issue.severity}] ` : "";
    const loc = issue.file ? ` — \`${esc(issue.file)}${issue.line ? `:${issue.line}` : ""}\`` : "";
    const id = issue.id ? `${issue.id}: ` : "";
    const desc = esc(issue.description || issue.message || "(no description)");
    lines.push(`- ${sev}${id}${desc}${loc}`);
  }
  return lines.join("\n");
}

function formatSonarBlock(data) {
  const parts = [];
  if (data.sonarSummary) parts.push(esc(data.sonarSummary));
  if (Number.isFinite(data.sonarIssuesFound)) {
    const resolved = Number.isFinite(data.sonarIssuesResolved) ? ` (${data.sonarIssuesResolved} resolved)` : "";
    parts.push(`Issues: ${data.sonarIssuesFound}${resolved}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatSolomonBlock(solomon) {
  if (!solomon || !solomon.ruling) return null;
  const lines = [`**Ruling**: \`${esc(solomon.ruling)}\``];
  if (solomon.reasoning) lines.push(`**Reasoning**: ${esc(solomon.reasoning)}`);
  return lines.join("  \n");
}

/**
 * Render a single iteration as a Markdown section.
 *
 * @param {IterationData} data
 * @returns {string}
 */
export function renderIterationEntry(data) {
  const lines = [`## Iteration ${data.iteration}`, ""];
  lines.push(`**Duration**: ${formatDuration(data.durationMs)}`);

  if (data.coderSummary) {
    lines.push("", "### Coder", data.coderSummary);
  }

  if (data.reviewerSummary || (data.blockingIssues && data.blockingIssues.length > 0)) {
    lines.push("", "### Reviewer");
    if (data.reviewerSummary) lines.push(data.reviewerSummary);
    const blocks = formatBlockingIssues(data.blockingIssues);
    if (blocks) {
      lines.push("", blocks);
    }
  }

  const sonarLine = formatSonarBlock(data);
  if (sonarLine) {
    lines.push("", "### Sonar", sonarLine);
  }

  if (data.testerSummary) lines.push("", "### Tester", data.testerSummary);
  if (data.securitySummary) lines.push("", "### Security", data.securitySummary);

  const solomonBlock = formatSolomonBlock(data.solomon);
  if (solomonBlock) {
    lines.push("", "### Solomon", solomonBlock);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Append an iteration record to session._journalIterations.
 * Creates the array if absent. Callers pass structured IterationData.
 *
 * @param {Object} session
 * @param {IterationData} data
 */
export function recordIteration(session, data) {
  if (!session || !data) return;
  if (!Array.isArray(session._journalIterations)) session._journalIterations = [];
  session._journalIterations.push(renderIterationEntry(data));
}

/**
 * Build the full iterations.md content from recorded entries.
 * Returns null when there are no iterations to render.
 *
 * @param {Object} session
 * @returns {string|null}
 */
export function buildIterationsMarkdown(session) {
  const entries = Array.isArray(session?._journalIterations) ? session._journalIterations : [];
  if (entries.length === 0) return null;
  const header = [
    `# Session iterations — ${session.id || "(unknown)"}`,
    "",
    `_Generated at ${new Date().toISOString()}._`,
    "",
    `Total iterations: **${entries.length}**`,
    "",
    "---",
    "",
  ].join("\n");
  return header + entries.join("---\n\n") + "\n";
}

/**
 * Extract structured iteration data from a stageResults bundle + session state.
 * The orchestrator produces stage results per role; this helper pulls the
 * relevant fields into a single object suitable for recordIteration().
 *
 * @param {Object} args
 * @param {number} args.iteration
 * @param {number} args.durationMs
 * @param {Object} args.stageResults
 * @param {Object} [args.session]
 * @returns {IterationData}
 */
export function extractIterationData({ iteration, durationMs, stageResults = {}, session = {} }) {
  const coderSummary = stageResults.coder?.summary || stageResults.coder?.result?.summary;
  const reviewerSummary = stageResults.reviewer?.summary;
  const blockingIssues = stageResults.reviewer?.result?.blocking_issues
    || stageResults.reviewer?.blocking_issues
    || [];
  const testerSummary = stageResults.tester?.summary;
  const securitySummary = stageResults.security?.summary;
  const sonarSummary = stageResults.sonar?.summary
    || (stageResults.sonar?.openIssues != null ? `${stageResults.sonar.openIssues} open issue(s)` : undefined);
  const sonarIssuesFound = stageResults.sonar?.issuesInitial ?? stageResults.sonar?.issuesFound;
  const sonarIssuesResolved = stageResults.sonar?.issuesResolved;

  // Solomon ruling for THIS iteration: match by iteration if the session
  // tracks it; otherwise just take the latest ruling.
  const rulings = Array.isArray(session.solomonRulings) ? session.solomonRulings : [];
  const solomonRecord = rulings.find((r) => r.iteration === iteration) || rulings.at(-1);
  const solomon = solomonRecord ? { ruling: solomonRecord.ruling, reasoning: solomonRecord.reasoning } : undefined;

  return {
    iteration,
    durationMs,
    coderSummary,
    reviewerSummary,
    blockingIssues,
    sonarSummary,
    sonarIssuesFound,
    sonarIssuesResolved,
    testerSummary,
    securitySummary,
    solomon,
  };
}

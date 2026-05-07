import { ANSI } from "./formatters.js";

export function printSessionStages(stages) {
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

export function printSessionSonar(sonar) {
  if (!sonar) return;
  // Three buckets so the banner reads correctly:
  //   - OK                                 \u2192 green (real pass).
  //   - SKIPPED / PENDING                  \u2192 gray (informational; sonar
  //     wasn't gated against, this is NOT a fail). Pre-2026-05-07 N4
  //     dogfooding these were rendered red, which made a clean run
  //     look like a sonar failure during the live demo.
  //   - everything else (ERROR, WARN, ...) \u2192 red (real fail).
  let gateLabel;
  if (sonar.gateStatus === "OK") gateLabel = ANSI.green;
  else if (sonar.gateStatus === "SKIPPED" || sonar.gateStatus === "PENDING") gateLabel = ANSI.gray;
  else gateLabel = ANSI.red;
  console.log(`  ${ANSI.dim}\ud83d\udd0d Sonar: ${gateLabel}${sonar.gateStatus}${ANSI.reset}${ANSI.dim} (${sonar.openIssues ?? 0} issues)${ANSI.reset}`);
  if (typeof sonar.issuesInitial === "number" || typeof sonar.issuesResolved === "number") {
    const issuesInitial = sonar.issuesInitial ?? sonar.openIssues ?? 0;
    const issuesFinal = sonar.issuesFinal ?? sonar.openIssues ?? 0;
    const issuesResolved = sonar.issuesResolved ?? Math.max(issuesInitial - issuesFinal, 0);
    console.log(`  ${ANSI.dim}\ud83d\udee0 Issues: ${issuesInitial} detected, ${issuesFinal} open, ${issuesResolved} resolved${ANSI.reset}`);
  }
}

export function printSessionGit(git) {
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

export function printSessionRtkSavings(rtkSavings) {
  if (!rtkSavings || !rtkSavings.callCount) return;
  const tokens = rtkSavings.estimatedTokensSaved ?? 0;
  const ratio = rtkSavings.savedPct ?? 0;
  const commands = rtkSavings.callCount ?? 0;
  const original = rtkSavings.originalBytes ?? 0;
  const compressed = rtkSavings.rtkBytes ?? 0;

  if (tokens === 0 || ratio === 0) {
    console.log(`  ${ANSI.dim}⚡ RTK: ${commands} commands wrapped, 0% savings — output was already minimal (${original} bytes in, ${compressed} bytes out)${ANSI.reset}`);
  } else {
    console.log(`  ${ANSI.dim}⚡ RTK: saved ~${tokens.toLocaleString()} tokens (${ratio}% compression, ${commands} commands, ${original.toLocaleString()} → ${compressed.toLocaleString()} bytes)${ANSI.reset}`);
  }
}

export function printSessionBudget(budget) {
  if (!budget) return;
  if (isBudgetUnavailable(budget)) {
    console.log(`  ${ANSI.dim}\ud83d\udcb0 Budget: N/A (provider does not report usage)${ANSI.reset}`);
    return;
  }
  const estPrefix = budget.includes_estimates ? "~" : "";
  const estNote = budget.includes_estimates ? " (includes estimates)" : "";
  const fmtTokens = (n) => Number(n || 0).toLocaleString("en-US");
  console.log(`  ${ANSI.dim}\ud83d\udcb0 Total tokens: ${estPrefix}${fmtTokens(budget.total_tokens)}${estNote}${ANSI.reset}`);
  console.log(`  ${ANSI.dim}\ud83d\udcb0 Total cost: ${estPrefix}$${Number(budget.total_cost_usd || 0).toFixed(2)}${ANSI.reset}`);
  // KJC-TSK-0274: KJ-vs-non-KJ comparison line when compression data exists.
  const cmp = budget.kj_comparison;
  if (cmp?.hasCompression) {
    const wkCost = `$${Number(cmp.withKj?.cost || 0).toFixed(2)}`;
    const wkTok = fmtTokens(Number(cmp.withKj?.tokens || 0));
    const wnCost = `$${Number(cmp.withoutKj?.cost || 0).toFixed(2)}`;
    const wnTok = fmtTokens(Number(cmp.withoutKj?.tokens || 0));
    const pct = Math.round(Number(cmp.savedPct || 0));
    console.log(`  ${ANSI.dim}   \u2937 With KJ: ${wkCost} / ${wkTok} tokens${ANSI.reset}`);
    console.log(`  ${ANSI.dim}   \u2937 Without KJ: ~${wnCost} / ~${wnTok} tokens (-${pct}%)${ANSI.reset}`);
  }
  for (const [role, metrics] of Object.entries(budget.breakdown_by_role || {})) {
    const tokens = Number(metrics.total_tokens || 0);
    const cost = Number(metrics.total_cost_usd || 0);
    if (tokens === 0 && cost === 0) continue; // skip roles with no usage
    console.log(
      `  ${ANSI.dim}   - ${role}: ${estPrefix}${fmtTokens(tokens)} tokens, ${estPrefix}$${cost.toFixed(2)}${ANSI.reset}`
    );
  }
}

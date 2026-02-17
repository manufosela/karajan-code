const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on reviewing the code."
].join(" ");

export function buildReviewerPrompt({ task, diff, reviewRules, mode }) {
  const truncatedDiff = diff.length > 12000 ? `${diff.slice(0, 12000)}\n\n[TRUNCATED]` : diff;

  return [
    SUBAGENT_PREAMBLE,
    `You are a code reviewer in ${mode} mode.`,
    "Return only one valid JSON object and nothing else.",
    "JSON schema:",
    '{"approved":boolean,"blocking_issues":[{"id":string,"severity":"critical|high|medium|low","file":string,"line":number,"description":string,"suggested_fix":string}],"non_blocking_suggestions":[string],"summary":string,"confidence":number}',
    `Task context:\n${task}`,
    `Review rules:\n${reviewRules}`,
    `Git diff:\n${truncatedDiff}`
  ].join("\n\n");
}

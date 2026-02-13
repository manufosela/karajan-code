export function buildReviewerPrompt({ task, diff, reviewRules, mode }) {
  return [
    `You are a strict code reviewer in ${mode} mode.`,
    `Task context:\n${task}`,
    `Review rules:\n${reviewRules}`,
    `Git diff:\n${diff}`,
    "Respond only as JSON with keys: approved, blocking_issues, non_blocking_suggestions, summary, confidence."
  ].join("\n\n");
}

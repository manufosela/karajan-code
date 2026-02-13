export function buildCoderPrompt({ task, reviewerFeedback = null, sonarSummary = null }) {
  const sections = [
    `Task:\n${task}`,
    "Implement directly in the repository.",
    "Keep changes minimal and production-ready."
  ];

  if (sonarSummary) {
    sections.push(`Sonar summary:\n${sonarSummary}`);
  }

  if (reviewerFeedback) {
    sections.push(`Reviewer blocking feedback:\n${reviewerFeedback}`);
  }

  return sections.join("\n\n");
}

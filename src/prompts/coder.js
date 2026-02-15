export function buildCoderPrompt({ task, reviewerFeedback = null, sonarSummary = null, methodology = "tdd" }) {
  const sections = [
    `Task:\n${task}`,
    "Implement directly in the repository.",
    "Keep changes minimal and production-ready."
  ];

  if (methodology === "tdd") {
    sections.push(
      [
        "Default development policy: TDD.",
        "1) Add or update failing tests first.",
        "2) Implement minimal code to make tests pass.",
        "3) Refactor safely while keeping tests green."
      ].join("\n")
    );
  }

  if (sonarSummary) {
    sections.push(`Sonar summary:\n${sonarSummary}`);
  }

  if (reviewerFeedback) {
    sections.push(`Reviewer blocking feedback:\n${reviewerFeedback}`);
  }

  return sections.join("\n\n");
}

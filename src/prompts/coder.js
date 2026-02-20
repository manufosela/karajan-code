const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Execute the task directly. Do NOT use any MCP tools. Focus only on coding."
].join(" ");

export function buildCoderPrompt({ task, reviewerFeedback = null, sonarSummary = null, coderRules = null, methodology = "tdd" }) {
  const sections = [
    SUBAGENT_PREAMBLE,
    `Task:\n${task}`,
    "Implement directly in the repository.",
    "Keep changes minimal and production-ready."
  ];

  if (coderRules) {
    sections.push(`Coder rules (MUST follow):\n${coderRules}`);
  }

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

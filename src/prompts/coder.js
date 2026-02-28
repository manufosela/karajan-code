const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Execute the task directly. Do NOT use any MCP tools. Focus only on coding."
].join(" ");

const SUBAGENT_PREAMBLE_SERENA = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Execute the task directly. Focus only on coding."
].join(" ");

const SERENA_INSTRUCTIONS = [
  "## Serena MCP — symbol-level code navigation",
  "You have access to Serena MCP tools for efficient code navigation.",
  "Prefer these over reading entire files to save tokens:",
  "- `find_symbol(name)` — locate a function, class, or variable definition",
  "- `find_referencing_symbols(name)` — find all code that references a symbol",
  "- `insert_after_symbol(name, code)` — insert code precisely after a symbol",
  "Use Serena for understanding existing code structure before making changes.",
  "Fall back to reading files only when Serena tools are not sufficient."
].join("\n");

export function buildCoderPrompt({ task, reviewerFeedback = null, sonarSummary = null, coderRules = null, methodology = "tdd", serenaEnabled = false }) {
  const sections = [
    serenaEnabled ? SUBAGENT_PREAMBLE_SERENA : SUBAGENT_PREAMBLE,
    `Task:\n${task}`,
    "Implement directly in the repository.",
    "Keep changes minimal and production-ready."
  ];

  if (serenaEnabled) {
    sections.push(SERENA_INSTRUCTIONS);
  }

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

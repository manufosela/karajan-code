import { RTK_INSTRUCTIONS } from "./rtk-snippet.js";

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

const SUBPROCESS_CONSTRAINTS = [
  "## Environment constraints",
  "You run as a non-interactive subprocess (no stdin, no TTY).",
  "- If the task requires a CLI wizard or interactive init (e.g. `create-react-app`, `pnpm create astro`, `npm init`), ALWAYS use non-interactive flags: `--yes`, `--no-input`, `--template <name>`, `--defaults`, etc.",
  "- Never run a command that waits for user input — it will hang forever.",
  "- If a task absolutely cannot be done non-interactively, say so explicitly instead of hanging."
].join("\n");

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

export function buildCoderPrompt({ task, reviewerFeedback = null, sonarSummary = null, coderRules = null, methodology = "tdd", serenaEnabled = false, rtkAvailable = false, deferredContext = null, productContext = null }) {
  const sections = [
    serenaEnabled ? SUBAGENT_PREAMBLE_SERENA : SUBAGENT_PREAMBLE,
    `Task:\n${task}`,
    "Implement directly in the repository.",
    "Keep changes minimal and production-ready.",
    SUBPROCESS_CONSTRAINTS
  ];

  if (serenaEnabled) {
    sections.push(SERENA_INSTRUCTIONS);
  }

  if (rtkAvailable) {
    sections.push(RTK_INSTRUCTIONS);
  }

  if (productContext) {
    sections.push(`## Product Context\n${productContext}`);
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

  if (deferredContext) {
    sections.push(deferredContext);
  }

  return sections.join("\n\n");
}

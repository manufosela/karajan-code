const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on task complexity triage."
].join(" ");

const ROLE_DESCRIPTIONS = [
  { role: "planner", description: "Generates an implementation plan before coding. Useful for complex multi-file tasks." },
  { role: "researcher", description: "Investigates the codebase for context before coding. Useful when understanding existing code is needed." },
  { role: "tester", description: "Runs dedicated testing pass after coding. Ensures tests exist and pass." },
  { role: "security", description: "Audits code for security vulnerabilities. Checks auth, input validation, injection risks." },
  { role: "refactorer", description: "Cleans up and refactors code after the main implementation." },
  { role: "reviewer", description: "Reviews the code diff for quality issues. Standard quality gate." },
  { role: "architect", description: "Designs solution architecture — layers, patterns, data model, API contracts, tradeoffs. Activate when task creates new module/app, affects data model/APIs, complexity is medium/complex, or design is ambiguous." },
  { role: "hu-reviewer", description: "Certifies user stories before coding. Activate for medium/complex tasks that need story decomposition." }
];

export function buildTriagePrompt({ task, instructions, availableRoles }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  const roles = availableRoles || ROLE_DESCRIPTIONS;

  sections.push(
    "You are a task triage agent for Karajan Code, a multi-agent coding orchestrator.",
    "Analyze the following task and determine which pipeline roles should be activated.",
    "## Available Roles",
    roles.map((r) => `- **${r.role}**: ${r.description}`).join("\n"),
    "## Decision Guidelines",
    [
      "- **planner**: Enable for complex tasks (multi-file, architectural changes, data model changes). Disable for simple fixes.",
      "- **researcher**: Enable when the task needs codebase context, API understanding, or investigation. Disable for standalone new files.",
      "- **tester**: Enable for any task with logic, APIs, components, services. Disable ONLY for pure documentation, comments, or CSS-only changes.",
      "- **security**: Enable for authentication, APIs, user input handling, data access, external integrations. Disable for UI-only or doc changes.",
      "- **refactorer**: Enable only when explicitly requested or when the task is a refactoring task.",
      "- **reviewer**: Enable for most tasks as a quality gate. Disable only for trivial, single-line changes.",
      "- **architect**: Enable when creating new modules/apps, changing data models or APIs, medium/complex tasks, or when design approach is ambiguous. Disable for simple fixes, doc-only, or CSS-only changes.",
      "- **hu-reviewer**: Enable for medium/complex tasks that benefit from story decomposition and certification. Disable for trivial/simple tasks, doc-only, or CSS-only changes.",
      "",
      "Note: coder is ALWAYS active — you don't need to decide on it."
    ].join("\n"),
    "Classify the task complexity, determine its taskType, recommend only the necessary pipeline roles, and assess whether the task should be decomposed into smaller subtasks.",
    "Keep the reasoning short and practical.",
    "Return a single valid JSON object and nothing else.",
    'JSON schema: {"level":"trivial|simple|medium|complex","roles":["planner|researcher|refactorer|reviewer|tester|security|architect|hu-reviewer"],"taskType":"sw|infra|doc|add-tests|refactor","reasoning":string,"shouldDecompose":boolean,"subtasks":string[]}',
    `## Task\n${task}`
  );

  return sections.join("\n\n");
}

export { ROLE_DESCRIPTIONS };

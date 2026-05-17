/**
 * HU Auto-Generator — converts triage subtasks (+ researcher/architect context)
 * into a certified HU batch ready for hu-sub-pipeline execution.
 *
 * Input: original task, triage subtasks, detected stack, researcher/architect context.
 * Output: HU batch with setup HU (when needed), task HUs with per-HU task_type,
 *         and a dependency graph (setup blocks everything; remaining linear by default).
 */

/**
 * Derive a human-readable project name from a task prompt.
 * Strips common action verbs + stopwords, takes up to 6 meaningful words,
 * and title-cases the result. Max 60 chars.
 */
export function deriveProjectName(originalTask) {
  if (!originalTask || typeof originalTask !== "string") return "Untitled Project";
  const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "with", "for", "to", "of", "in", "on",
    "is", "it", "its", "this", "that", "these", "those", "be", "been", "being",
    "build", "create", "implement", "make", "develop", "add", "set", "up",
    "setup", "write", "code", "new", "complete", "from", "scratch",
    "application", "app", "tool", "system", "project", "using", "use",
    "full", "full-stack", "fullstack", "stack", "based", "simple", "basic"
  ]);
  const words = originalTask
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w));
  const meaningful = words.slice(0, 6);
  if (meaningful.length === 0) {
    return originalTask.slice(0, 60).trim() || "Untitled Project";
  }
  const titled = meaningful
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return titled.length > 60 ? titled.slice(0, 57) + "..." : titled;
}

/**
 * Classify a subtask into a Karajan task_type.
 * Maps free-text subtask descriptions to {infra|sw|add-tests|doc|refactor|nocode}.
 */
export function classifyTaskType(text) {
  if (!text || typeof text !== "string") return "sw";
  const t = text.toLowerCase();
  // Order matters: no-code beats infra (Zapier/Notion setups are no-code, not infra)
  if (/\b(no-code|nocode|zapier|make\.com|airtable|notion)\b/.test(t)) return "nocode";
  if (/\b(setup|install|init(?:ialize|iate)?|configure|scaffold|bootstrap)\b/.test(t)) return "infra";
  if (/\b(docker|ci\/cd|pipeline|deploy|workflow\.yml|github actions?)\b/.test(t)) return "infra";
  if (/\b(tests?|coverage|spec|vitest|jest|mocha|playwright)\b/.test(t) && !/\b(component|feature|endpoint)\b/.test(t)) return "add-tests";
  if (/\b(readme|docs?|documentation|guide|tutorial)\b/.test(t)) return "doc";
  if (/\b(refactor|cleanup|reorganiz|restructure|extract)\b/.test(t)) return "refactor";
  return "sw";
}

/**
 * Decide whether a setup HU is needed.
 * Needed when: project is new OR stack hints suggest new dependencies.
 */
export function needsSetupHu({ isNewProject = false, stackHints = [], subtasks = [] }) {
  if (isNewProject) return true;
  if (stackHints.length > 0) return true;
  // Subtasks mentioning a framework/tool suggest fresh setup
  const setupKeywords = /\b(npm init|package\.json|workspace|monorepo|vite|vitest|express|astro|next\.js|nestjs)\b/i;
  return subtasks.some(s => setupKeywords.test(s));
}

/**
 * Filter conflicting stack hints. When Node.js ecosystem keywords are present,
 * remove Go/Rust/Python keywords that were detected from gitignore patterns
 * but aren't actually part of the task.
 */
function filterConflictingHints(hints) {
  if (!hints || hints.length === 0) return hints;
  const nodeEcosystem = new Set(["express", "vite", "vitest", "jest", "next", "astro", "react", "vue", "svelte", "nestjs", "monorepo", "workspaces"]);
  const goKeywords = new Set(["gin", "fiber", "go"]);
  const hasNode = hints.some(h => nodeEcosystem.has(h));
  if (!hasNode) return hints;
  return hints.filter(h => !goKeywords.has(h));
}

/**
 * Build a MINIMAL setup HU — project structure + deps only.
 * NEVER includes the full original task. The coder must only do setup.
 */
function buildSetupHu({ stackHints }) {
  const deps = stackHints.length > 0
    ? stackHints.map(h => `- ${h}`).join("\n")
    : "- (auto-detect from subsequent HUs)";
  const certifiedText = [
    "**Setup: initialize project structure and install dependencies.**",
    "",
    "SCOPE (do ONLY this, nothing else):",
    "- Create package.json (with workspaces if monorepo detected from stack hints)",
    "- Install all runtime + dev dependencies listed in stack hints",
    "- Install test framework WITH coverage reporter (e.g. vitest + @vitest/coverage-v8)",
    "- Configure vitest.config.js with coverage.enabled = true",
    "- Create .env.example with placeholder variables",
    "- Verify by running each acceptance_test command below",
    "",
    "DO NOT implement any business logic, API routes, components, or features.",
    "This HU is ONLY project scaffolding.",
    "",
    "Stack hints:",
    deps
  ].join("\n");
  return {
    id: "HU-01",
    title: "Setup: project structure + dependencies",
    task_type: "infra",
    status: "certified",
    blocked_by: [],
    certified: { text: certifiedText },
    acceptance_criteria: [
      "npm install succeeds without errors",
      "npm test runs without error",
      "npm run test:coverage runs without error",
      ".env.example exists"
    ],
    acceptance_tests: [
      "npm install --ignore-scripts 2>&1 && echo PASS || echo FAIL",
      "npx vitest run 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
      "npx vitest run --coverage 2>&1 | grep -q 'All files\\|% Stmts' && echo PASS || echo FAIL",
      "test -f .env.example && echo PASS || echo FAIL"
    ]
  };
}

/**
 * Build a MINIMAL task HU — one specific, focused piece of work.
 * Includes a short goal reference (max 80 chars) NOT the full task.
 */
function buildTaskHu({ id, subtask, projectName, blockedBy }) {
  const taskType = classifyTaskType(subtask);
  const certifiedText = [
    `**${subtask}**`,
    "",
    `Project: ${projectName}`,
    "",
    "SCOPE (do ONLY this, nothing else):",
    `- Implement: ${subtask}`,
    "- Add unit tests for the new code",
    "- Run ALL acceptance_tests listed below and ensure they pass",
    "- Do NOT touch code outside this subtask's scope",
    "- Target: <200 lines changed (like an atomic PR)"
  ].join("\n");
  return {
    id,
    title: subtask.length > 80 ? subtask.slice(0, 77) + "..." : subtask,
    task_type: taskType,
    status: "certified",
    blocked_by: blockedBy,
    certified: { text: certifiedText },
    acceptance_criteria: [
      `${subtask} is implemented and working`,
      "Unit tests cover the new code",
      "All acceptance_tests pass"
    ],
    acceptance_tests: [
      "npx vitest run 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
      "npx vitest run --coverage 2>&1 | grep -q 'All files\\|% Stmts' && echo PASS || echo FAIL"
    ]
  };
}

/**
 * Main entry point: generate a certified HU batch from triage output.
 *
 * @param {object} input
 * @param {string} input.originalTask - the user's raw task
 * @param {string[]} input.subtasks - triage.subtasks array
 * @param {string[]} [input.stackHints] - detected stack keywords (e.g. ["nodejs", "vitest"])
 * @param {boolean} [input.isNewProject] - true when projectDir is empty/fresh
 * @param {string} [input.researcherContext] - researcher output (optional, used for better HU text)
 * @param {string} [input.architectContext] - architect output (optional, used for dep graph)
 * @returns {{ stories: object[], total: number, certified: number, generated: true }}
 */
export function generateHuBatch({
  originalTask,
  subtasks = [],
  stackHints = [],
  isNewProject = false,
  researcherContext = null,
  architectContext = null
}) {
  if (!originalTask || typeof originalTask !== "string") {
    throw new Error("generateHuBatch: originalTask is required");
  }
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    throw new Error("generateHuBatch: subtasks array is required");
  }

  const stories = [];
  const filteredHints = filterConflictingHints(stackHints);
  const needsSetup = needsSetupHu({ isNewProject, stackHints: filteredHints, subtasks });
  let nextId = 1;

  const projectName = deriveProjectName(originalTask);

  if (needsSetup) {
    stories.push(buildSetupHu({ stackHints: filteredHints }));
    nextId = 2;
  }

  // Task HUs: linear dependency chain after setup (conservative default).
  const setupId = needsSetup ? "HU-01" : null;
  let previousId = setupId;
  for (const subtask of subtasks) {
    const id = `HU-${String(nextId).padStart(2, "0")}`;
    const blockedBy = [];
    if (setupId) blockedBy.push(setupId);
    if (previousId && previousId !== setupId) blockedBy.push(previousId);
    stories.push(buildTaskHu({ id, subtask, projectName, blockedBy }));
    previousId = id;
    nextId += 1;
  }

  return {
    stories,
    total: stories.length,
    certified: stories.length,
    projectName: deriveProjectName(originalTask),
    generated: true,
    source: { triage_subtasks: subtasks.length, researcher: Boolean(researcherContext), architect: Boolean(architectContext) }
  };
}

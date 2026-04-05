/**
 * HU Auto-Generator — converts triage subtasks (+ researcher/architect context)
 * into a certified HU batch ready for hu-sub-pipeline execution.
 *
 * Input: original task, triage subtasks, detected stack, researcher/architect context.
 * Output: HU batch with setup HU (when needed), task HUs with per-HU task_type,
 *         and a dependency graph (setup blocks everything; remaining linear by default).
 */

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
 * Build the setup HU story from stack hints + subtasks.
 */
function buildSetupHu({ stackHints, subtasks, originalTask }) {
  const hintList = stackHints.length > 0
    ? stackHints.map(h => `- ${h}`).join("\n")
    : "- Detect required dependencies from task and install them";
  const certifiedText = [
    `**Setup project infrastructure and dependencies.**`,
    ``,
    `Original goal: ${originalTask}`,
    ``,
    `**Scope:**`,
    `- Initialize project structure (package.json, workspaces if monorepo)`,
    `- Install all dependencies required by the task`,
    `- Configure tooling (test framework, linter, build tool)`,
    `- Create .env.example with all required env vars`,
    `- Verify install works (npm install, npm run test --run)`,
    ``,
    `**Stack hints:**`,
    hintList
  ].join("\n");
  return {
    id: "HU-01",
    title: "Setup project infrastructure",
    task_type: "infra",
    status: "certified",
    blocked_by: [],
    certified: { text: certifiedText },
    acceptance_criteria: [
      "Project builds without errors (npm install succeeds)",
      "Test framework is installed and 'npm test' runs (even with 0 tests)",
      "All declared dependencies match what the task requires",
      ".env.example exists with documented variables"
    ]
  };
}

/**
 * Build a task HU story from a subtask description.
 */
function buildTaskHu({ id, subtask, originalTask, blockedBy }) {
  const taskType = classifyTaskType(subtask);
  const certifiedText = [
    `**${subtask}**`,
    ``,
    `Part of: ${originalTask}`,
    ``,
    `**Scope:** implement this subtask only. Do not touch unrelated subtasks.`
  ].join("\n");
  return {
    id,
    title: subtask.length > 80 ? subtask.slice(0, 77) + "..." : subtask,
    task_type: taskType,
    status: "certified",
    blocked_by: blockedBy,
    certified: { text: certifiedText },
    acceptance_criteria: [
      `Subtask '${subtask}' is implemented`,
      `Unit tests cover the new code (where applicable)`,
      `No regressions in existing functionality`
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
  const needsSetup = needsSetupHu({ isNewProject, stackHints, subtasks });
  let nextId = 1;

  if (needsSetup) {
    stories.push(buildSetupHu({ stackHints, subtasks, originalTask }));
    nextId = 2;
  }

  // Task HUs: linear dependency chain after setup (conservative default).
  // Architect context could later inform parallel-safe groupings.
  const setupId = needsSetup ? "HU-01" : null;
  let previousId = setupId;
  for (const subtask of subtasks) {
    const id = `HU-${String(nextId).padStart(2, "0")}`;
    const blockedBy = [];
    if (setupId) blockedBy.push(setupId);
    // Conservative: also depend on previous task HU to enforce linear execution.
    // Later phases can relax this with architect-informed graph.
    if (previousId && previousId !== setupId) blockedBy.push(previousId);
    stories.push(buildTaskHu({ id, subtask, originalTask, blockedBy }));
    previousId = id;
    nextId += 1;
  }

  return {
    stories,
    total: stories.length,
    certified: stories.length,
    generated: true,
    source: { triage_subtasks: subtasks.length, researcher: Boolean(researcherContext), architect: Boolean(architectContext) }
  };
}

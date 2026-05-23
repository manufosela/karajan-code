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

// Stack-hint keyword sets. Used by filterConflictingHints (drop hints
// from other ecosystems once one is detected) and by
// resolveLanguageFromHints (pick the canonical language for setup +
// acceptance_tests templates).
const HINT_NODE = new Set(["express", "vite", "vitest", "jest", "next", "astro", "react", "vue", "svelte", "nestjs", "monorepo", "workspaces"]);
const HINT_PYTHON = new Set(["pytest", "flask", "fastapi", "django", "numpy", "pandas"]);
const HINT_GO = new Set(["gin", "fiber", "go"]);
const HINT_RUST = new Set(["cargo", "rust"]);

/**
 * Drop hints from OTHER ecosystems when one is clearly the project's.
 * Symmetric: previously only node-vs-go was filtered, so a Python
 * project that also had "vitest" in a stale gitignore would still
 * receive vitest in its setup HU.
 */
function filterConflictingHints(hints) {
  if (!hints || hints.length === 0) return hints;
  const setForEachLang = [
    ["python", HINT_PYTHON],
    ["go", HINT_GO],
    ["rust", HINT_RUST],
    ["node", HINT_NODE],
  ];
  const present = setForEachLang.filter(([, set]) => hints.some((h) => set.has(h)));
  if (present.length <= 1) return hints;
  // First ecosystem found in the original hints order wins. We keep
  // ambiguous keywords (those not in any set) and the winner's own
  // keywords; we drop the explicit losers from competing ecosystems.
  const winnerSet = present[0][1];
  const losers = present.slice(1).flatMap(([, s]) => [...s]);
  return hints.filter((h) => winnerSet.has(h) || !losers.includes(h));
}

/**
 * Pick the canonical language for setup + acceptance_test templates
 * based on the (already filtered) stack hints. Falls back to
 * javascript so existing Node-centric runs keep their previous shape.
 * @param {string[]} hints
 * @returns {"python"|"go"|"rust"|"javascript"}
 */
export function resolveLanguageFromHints(hints) {
  if (!hints || hints.length === 0) return "javascript";
  if (hints.some((h) => HINT_PYTHON.has(h))) return "python";
  if (hints.some((h) => HINT_GO.has(h))) return "go";
  if (hints.some((h) => HINT_RUST.has(h))) return "rust";
  return "javascript";
}

// HU templates per language. The JS template is the legacy default;
// the others were missing — every autogenerated HU got vitest /
// npm-install hardcoded acceptance_tests regardless of stack.
const HU_TEMPLATES = {
  javascript: {
    pkgManager: "npm",
    setupBullets: [
      "- Create package.json (with workspaces if monorepo detected from stack hints)",
      "- Install all runtime + dev dependencies listed in stack hints",
      "- Install test framework WITH coverage reporter (e.g. vitest + @vitest/coverage-v8)",
      "- Configure vitest.config.js with coverage.enabled = true",
      "- Create .env.example with placeholder variables",
    ],
    setupCriteria: [
      "npm install succeeds without errors",
      "npm test runs without error",
      "npm run test:coverage runs without error",
      ".env.example exists",
    ],
    setupTests: [
      "npm install --ignore-scripts 2>&1 && echo PASS || echo FAIL",
      "npx vitest run 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
      "npx vitest run --coverage 2>&1 | grep -q 'All files\\|% Stmts' && echo PASS || echo FAIL",
      "test -f .env.example && echo PASS || echo FAIL",
    ],
    taskTests: [
      "npx vitest run 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
      "npx vitest run --coverage 2>&1 | grep -q 'All files\\|% Stmts' && echo PASS || echo FAIL",
    ],
  },
  python: {
    pkgManager: "pip",
    setupBullets: [
      "- Create pyproject.toml (preferred) or requirements.txt",
      "- Create a virtual env: python -m venv .venv",
      "- Install runtime + dev dependencies (pip install -e . or pip install -r requirements.txt)",
      "- Install pytest with coverage (pip install pytest pytest-cov)",
      "- Create .env.example with placeholder variables",
    ],
    setupCriteria: [
      "Project metadata file exists (pyproject.toml or requirements.txt)",
      "pytest runs without error",
      "pytest --cov reports a total",
      ".env.example exists",
    ],
    setupTests: [
      "(test -f pyproject.toml || test -f requirements.txt) && echo PASS || echo FAIL",
      "python -m pytest 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
      "python -m pytest --cov 2>&1 | grep -q 'TOTAL\\|coverage' && echo PASS || echo FAIL",
      "test -f .env.example && echo PASS || echo FAIL",
    ],
    taskTests: [
      "python -m pytest 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
      "python -m pytest --cov 2>&1 | grep -q 'TOTAL\\|coverage' && echo PASS || echo FAIL",
    ],
  },
  go: {
    pkgManager: "go",
    setupBullets: [
      "- Create go.mod with `go mod init <module>`",
      "- Install dependencies with `go get` per import",
      "- Create .env.example with placeholder variables",
    ],
    setupCriteria: [
      "go.mod exists",
      "go test ./... runs without error",
      "go test -cover reports coverage",
      ".env.example exists",
    ],
    setupTests: [
      "test -f go.mod && echo PASS || echo FAIL",
      "go test ./... 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
      "go test -cover ./... 2>&1 | grep -q 'coverage:' && echo PASS || echo FAIL",
      "test -f .env.example && echo PASS || echo FAIL",
    ],
    taskTests: [
      "go test ./... 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
    ],
  },
  rust: {
    pkgManager: "cargo",
    setupBullets: [
      "- Initialise the crate with `cargo init`",
      "- Add dependencies with `cargo add`",
      "- Create .env.example with placeholder variables",
    ],
    setupCriteria: [
      "Cargo.toml exists",
      "cargo test runs without error",
      ".env.example exists",
    ],
    setupTests: [
      "test -f Cargo.toml && echo PASS || echo FAIL",
      "cargo test 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
      "test -f .env.example && echo PASS || echo FAIL",
    ],
    taskTests: [
      "cargo test 2>&1; test $? -eq 0 && echo PASS || echo FAIL",
    ],
  },
};

function templateFor(language) {
  return HU_TEMPLATES[language] || HU_TEMPLATES.javascript;
}

/**
 * Build a MINIMAL setup HU — project structure + deps only.
 * NEVER includes the full original task. The coder must only do setup.
 */
function buildSetupHu({ stackHints, language = "javascript" }) {
  const tpl = templateFor(language);
  const deps = stackHints.length > 0
    ? stackHints.map(h => `- ${h}`).join("\n")
    : "- (auto-detect from subsequent HUs)";
  const certifiedText = [
    `**Setup: initialise the ${language} project + install dependencies (package manager: ${tpl.pkgManager}).**`,
    "",
    "SCOPE (do ONLY this, nothing else):",
    ...tpl.setupBullets,
    "- Verify by running each acceptance_test command below",
    "",
    "DO NOT implement any business logic, API routes, components, or features.",
    "This HU is ONLY project scaffolding.",
    "",
    "Stack hints:",
    deps,
  ].join("\n");
  return {
    id: "HU-01",
    title: `Setup: ${language} project structure + dependencies`,
    task_type: "infra",
    status: "certified",
    blocked_by: [],
    certified: { text: certifiedText },
    acceptance_criteria: tpl.setupCriteria,
    acceptance_tests: tpl.setupTests,
  };
}

/**
 * Build a MINIMAL task HU — one specific, focused piece of work.
 * Includes a short goal reference (max 80 chars) NOT the full task.
 */
function buildTaskHu({ id, subtask, projectName, blockedBy, language = "javascript" }) {
  const taskType = classifyTaskType(subtask);
  const tpl = templateFor(language);
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
    "- Target: <200 lines changed (like an atomic PR)",
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
      "All acceptance_tests pass",
    ],
    acceptance_tests: tpl.taskTests,
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
  architectContext = null,
  language = null,
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
  // Caller may pass a language explicitly (when it has a real
  // detectProjectStack result from the filesystem); otherwise fall
  // back to inferring from the hint keywords. Default 'javascript'
  // matches the previous behaviour for Node-centric runs.
  const resolvedLanguage = language || resolveLanguageFromHints(filteredHints);
  let nextId = 1;

  const projectName = deriveProjectName(originalTask);

  if (needsSetup) {
    stories.push(buildSetupHu({ stackHints: filteredHints, language: resolvedLanguage }));
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
    stories.push(buildTaskHu({ id, subtask, projectName, blockedBy, language: resolvedLanguage }));
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

import { buildRtkInstructions } from "./rtk-snippet.js";
import { loadAvailableSkills, buildSkillSection } from "../skills/skill-loader.js";
import { getLanguageInstruction } from "../utils/locale.js";

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

/**
 * Render structured acceptance_tests (v2.7.5) as a Markdown section the
 * coder reads as its contract. Legacy plain-string entries and
 * structured { type, content, file? } objects are both accepted.
 *
 * The layout is intentional:
 *   - Gherkin blocks preserve their newlines so the coder sees the
 *     Given/When/Then scenarios as-is.
 *   - Shell blocks are fenced so the coder can copy-paste to verify.
 *   - The header says "MUST pass" because this is the gate the tester
 *     role runs (phase 3) and refuses to approve without.
 *
 * @param {Array} tests
 * @returns {string}
 */
function renderAcceptanceTestsSection(tests) {
  if (!Array.isArray(tests) || tests.length === 0) return "";
  const lines = [
    "## Acceptance Tests — MUST pass before the HU can be approved",
    "",
    "These are the concrete contract for this task. The tester stage will execute them as the pass/fail gate — if any one fails, the HU is rejected. Write your implementation so each test passes.",
    "",
  ];
  tests.forEach((entry, i) => {
    // Normalise: accept legacy strings and structured objects.
    let type = "shell";
    let content;
    let file = null;
    if (typeof entry === "string") {
      content = entry;
    } else if (entry && typeof entry === "object") {
      type = entry.type === "gherkin" ? "gherkin" : "shell";
      content = typeof entry.content === "string" ? entry.content : JSON.stringify(entry);
      file = typeof entry.file === "string" && entry.file.trim() ? entry.file.trim() : null;
    } else {
      content = String(entry ?? "");
    }
    const heading = file
      ? `### Test ${i + 1} · \`${type}\` · target: \`${file}\``
      : `### Test ${i + 1} · \`${type}\``;
    lines.push(heading);
    if (type === "gherkin") {
      lines.push("```gherkin", content, "```", "");
    } else {
      lines.push("```bash", content, "```", "");
    }
  });
  lines.push(
    "If a test is ambiguous, implement what makes it pass AND add the clarifying assertion to the PR description — do NOT silently rewrite the test."
  );
  return lines.join("\n");
}

/**
 * Render the active ADRs (PR F) as a "MUST respect" preamble. Each
 * ADR is shown verbatim — they're already in Nygard format
 * (Context · Decision · Consequences) and the coder benefits from
 * the full text, not a summary. Keeps the prompt size sane: caps at
 * 8 ADRs (the planner shouldn't realistically emit more for one
 * plan, but bound it just in case).
 */
function renderAdrSection(adrs) {
  if (!Array.isArray(adrs) || adrs.length === 0) return "";
  const capped = adrs.slice(0, 8);
  const lines = [
    "## Architecture Decision Records (active)",
    "",
    "These ADRs were committed by the architect role. Your implementation MUST respect them. If the SPEC asks for something incompatible with one of these, surface the conflict in your PR description rather than silently overriding the ADR.",
    "",
  ];
  for (const adr of capped) {
    lines.push(adr.markdown.trim(), "", "---", "");
  }
  if (adrs.length > capped.length) {
    lines.push(`_(…${adrs.length - capped.length} more ADRs not shown — see ~/.kj/plans/<slug>/<planId>/adrs/.)_`, "");
  }
  return lines.join("\n");
}

/**
 * SPEC-section pointer (PR F). One short line. Lets the coder put
 * "implements §X.Y of SPEC.md" in the PR description for traceability.
 */
function renderSpecSectionLine(specSection) {
  if (!specSection) return "";
  return [
    "## SPEC reference",
    "",
    `This HU implements **§${specSection}** of the source SPEC. Cite this section in your PR description so the reviewer can trace coverage end-to-end.`,
  ].join("\n");
}

/**
 * Plan-reviewer findings relevant to this HU (PR F). The reviewer's
 * output is plan-wide; we filter to entries that mention the
 * current HU id so the coder gets only what's actionable for them.
 */
function renderReviewerFindingsSection(findings, huId) {
  if (!findings || !huId) return "";
  const items = [];
  for (const md of findings.missing_dependencies || []) {
    if (md.from === huId) items.push(`- This HU should depend on **${md.on}** — ${md.rationale}`);
    else if (md.on === huId) items.push(`- HU **${md.from}** should depend on this one — ${md.rationale}`);
  }
  for (const ov of findings.scope_overlaps || []) {
    if (Array.isArray(ov.between) && ov.between.includes(huId)) {
      const others = ov.between.filter((id) => id !== huId);
      items.push(`- Scope overlap with **${others.join(", ")}** — ${ov.rationale}`);
    }
  }
  for (const oi of findings.order_issues || []) {
    if (Array.isArray(oi.hus) && oi.hus.includes(huId)) {
      items.push(`- Order issue (${oi.issue}): ${oi.rationale}`);
    }
  }
  if (items.length === 0) return "";
  return [
    "## Reviewer findings about this HU",
    "",
    "The plan reviewer flagged the following — consider them while implementing:",
    "",
    ...items,
  ].join("\n");
}

// KJC sesgo-de-stack: Karajan used to default every prompt to JS/TS
// (vitest, npm install, console.log, JSDoc, httpOnly cookies). When
// the project is Python / Go / Rust / Ruby, that produced absurd
// outputs (e.g. installing vitest in a pure-python repo to satisfy a
// hardcoded `npx vitest run` acceptance test). When we know the
// stack we tell the coder explicitly so it stops assuming.
function buildStackSection({ stack, testFramework }) {
  if (!stack && !testFramework) return null;
  const lines = ["## Project Stack — match this, don't assume JavaScript"];
  if (stack?.language) lines.push(`- Language: **${stack.language}**`);
  if (stack?.frameworks?.length) lines.push(`- Frameworks: ${stack.frameworks.join(", ")}`);
  if (testFramework?.hasTests && testFramework?.framework) {
    lines.push(`- Test framework already in use: **${testFramework.framework}** (${testFramework.language || stack?.language || "unknown"}). Use it for new tests; do NOT add a JS test framework on top.`);
  } else if (stack?.language && stack.language !== "javascript" && stack.language !== "typescript") {
    lines.push(`- No test framework detected yet. Pick the canonical one for ${stack.language} (e.g. pytest for python, \`go test\` for go, \`cargo test\` for rust, rspec for ruby). Do NOT use vitest / jest / \`npm install\` in a non-JS project.`);
  }
  lines.push("");
  lines.push("If an acceptance_test command on this HU points at a foreign framework (e.g. `npx vitest run` on a python project), REPLACE the command with the equivalent for the project's actual stack and use that to verify your work.");
  return lines.join("\n");
}

export async function buildCoderPrompt({ task, reviewerFeedback = null, sonarSummary = null, coderRules = null, methodology = "tdd", serenaEnabled = false, rtkAvailable = false, deferredContext = null, productContext = null, domainContext = null, plan = null, projectDir = null, language = "en", provider = null, acceptanceTests = null, adrs = null, specSection = null, reviewerFindings = null, huId = null, stack = null, testFramework = null }) {
  const langInstruction = getLanguageInstruction(language);
  // KJC-BUG-0032 (PR-I): hard rule about file paths. Real bug: a HU
  // titled "Initialize project skeleton: create assistant/ directory…"
  // had Claude run `cd /home/manu/assistant && pnpm init …` and 36 MB
  // of code landed in $HOME instead of inside projectDir. Reinforce
  // the constraint at the prompt level (soft fix) AND enforce it
  // post-coder via fs-leak-detector.js (hard fix).
  const projectDirRule = projectDir
    ? [
        "## CRITICAL — Project directory boundary",
        `The project root is **${projectDir}**. EVERY file you create, write, edit, mkdir or cd to MUST stay inside this directory.`,
        "",
        "Forbidden, regardless of what the task says:",
        "- Absolute paths outside the project root (e.g. `/home/USER/something`, `/tmp/x`, `/etc/y`).",
        "- `cd` to any directory outside the project root inside Bash commands.",
        "- Creating sibling top-level directories under `$HOME`.",
        "",
        "If the task or HU title mentions a directory like `assistant/` or `app/`, treat it as RELATIVE to the project root. NEVER as an absolute path under $HOME.",
        "",
        "Karajan runs a deterministic post-coder guard that detects writes outside the project root and ABORTS the HU. If you ignore this rule the run will fail and your work will be discarded."
      ].join("\n")
    : null;

  const sections = [
    serenaEnabled ? SUBAGENT_PREAMBLE_SERENA : SUBAGENT_PREAMBLE,
    ...(langInstruction ? [langInstruction] : []),
    `Task:\n${task}`,
    "Implement directly in the repository.",
    "Keep changes minimal and production-ready.",
    "Follow SOLID principles. Write small, focused functions (< 30 lines).",
    "Make atomic commits: 1 logical change = 1 commit. Keep PRs small and reviewable.",
    "Security: validate all input, parameterize queries, never expose secrets. Use the auth pattern that matches the stack (e.g. httpOnly cookies for web sessions).",
    "Use the project's standard logger and type system (no console.log when a structured logger exists; use the project's type idiom — TS types, JSDoc, Python type hints, Go interfaces…).",
    SUBPROCESS_CONSTRAINTS
  ];
  const stackRule = buildStackSection({ stack, testFramework });
  if (stackRule) sections.push(stackRule);
  if (projectDirRule) sections.push(projectDirRule);

  if (serenaEnabled) {
    sections.push(SERENA_INSTRUCTIONS);
  }

  const rtkSnippet = buildRtkInstructions({ rtkAvailable });
  if (rtkSnippet) {
    sections.push(rtkSnippet);
  }

  if (productContext) {
    sections.push(`## Product Context\n${productContext}`);
  }

  if (domainContext) {
    sections.push(`## Domain Context\n${domainContext}`);
  }

  if (plan) {
    sections.push(`## Implementation Plan (from planner)\nFollow these steps:\n${plan}`);
  }

  // PR F context injections — order matters:
  //   1. ADRs first (they constrain HOW you implement),
  //   2. SPEC reference (what section we're satisfying),
  //   3. Reviewer findings about THIS HU (warnings the coder needs
  //      to consider while writing code),
  //   4. Acceptance tests (the gate the implementation must pass).
  // All four sit BEFORE coder rules / TDD policy so the policy
  // frames them, not the other way around.
  const adrSection = renderAdrSection(adrs);
  if (adrSection) sections.push(adrSection);

  const specSectionLine = renderSpecSectionLine(specSection);
  if (specSectionLine) sections.push(specSectionLine);

  const reviewerSection = renderReviewerFindingsSection(reviewerFindings, huId);
  if (reviewerSection) sections.push(reviewerSection);

  // Tests-first contract: the gate the implementation must pass.
  const testsSection = renderAcceptanceTestsSection(acceptanceTests);
  if (testsSection) {
    sections.push(testsSection);
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
    sections.push(
      `## Reviewer blocking feedback — YOU MUST FIX THESE BEFORE PROCEEDING`,
      reviewerFeedback,
      "",
      "For each issue above:",
      "1. Find the relevant file(s) in the project",
      "2. Make the specific code change needed to resolve the issue",
      "3. If tests are missing, write them",
      "4. If dependencies are needed, install them with the project's package manager (npm install / pip install / go get / cargo add — pick the one that matches the stack above)",
      "5. Do NOT skip any issue — all must be resolved"
    );
  }

  if (deferredContext) {
    sections.push(deferredContext);
  }

  if (projectDir) {
    const skills = await loadAvailableSkills(projectDir);
    const skillSection = buildSkillSection(skills, { provider });
    if (skillSection) {
      sections.push(skillSection);
    }
  }

  return sections.join("\n\n");
}

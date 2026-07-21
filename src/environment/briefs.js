/**
 * Role briefs (AB-C, KJC-TSK-0652) — the distilled METHOD of each pipeline
 * role, exposed to the brain via `kj brief <role>`. The brain executes the
 * brief itself (or delegates it) instead of depending on the subprocess
 * pipeline, which keeps these prompts for the headless mode only.
 *
 * Briefs are agent context: ≤40 lines by test, checklist over prose, and
 * every brief ends with "## Output" naming what the role must produce.
 */

const B = {
  triage: {
    purpose: "Size the task before touching anything",
    render: () => [
      "# Triage brief", "",
      "Classify the task BEFORE any code. Decide:",
      "1. Type: sw | infra | doc | add-tests | refactor.",
      "2. Complexity: simple (1 file, obvious change) | medium (2-5 files, one subsystem) | complex (cross-subsystem, data model, or security surface).",
      "3. Risk surfaces touched: auth, persistence, external I/O, money, PII.",
      "4. What the DONE state looks like — one falsifiable sentence.",
      "Query the RAG first (`kj rag query`) — never size from assumptions.", "",
      "## Output",
      "type, complexity, risks, done-statement. If complex: split into HUs before coding.",
    ].join("\n"),
  },
  planner: {
    purpose: "Turn the task into an ordered, committable plan",
    render: () => [
      "# Planner brief", "",
      "Produce the smallest plan that reaches DONE:",
      "1. Steps of ~1 commit each, ordered by dependency; each step names its files.",
      "2. Tests FIRST in every step that changes behavior.",
      "3. Flag steps needing data-model or API changes — they get their own step.",
      "4. Out-of-scope list: what you are explicitly NOT doing.",
      "5. Keep the whole change ≤150 net lines per PR; partition upfront if bigger.", "",
      "## Output",
      "Numbered steps {description, files, test-first?}, risks, out-of-scope.",
    ].join("\n"),
  },
  researcher: {
    purpose: "Ground the task in how the codebase actually works",
    render: () => [
      "# Researcher brief", "",
      "Before designing anything:",
      "1. `kj rag query` the subsystems the task touches; read the top hits.",
      "2. Find the existing pattern for this kind of change — mimic it, don't invent.",
      "3. List the load-bearing files and their owners (tests that pin them).",
      "4. Note conventions: naming, error handling, import style, test framework.", "",
      "## Output",
      "Facts with file:line references — never guesses. Unknowns listed explicitly.",
    ].join("\n"),
  },
  architect: {
    purpose: "Decide structure before code when the change is cross-cutting",
    render: () => [
      "# Architect brief", "",
      "Only for medium/complex tasks:",
      "1. Enumerate 2-3 viable designs; pick one and say WHY in two sentences.",
      "2. Respect existing ADRs and module boundaries — check them first.",
      "3. Data-model or API changes: spell out the migration/compat story.",
      "4. Prefer the design that deletes code over the one that adds layers.", "",
      "## Output",
      "Chosen design, discarded alternatives with reasons, affected boundaries.",
    ].join("\n"),
  },
  tester: {
    purpose: "Prove the change does what DONE says",
    render: (config) => {
      const tdd = config?.development?.methodology !== "standard";
      return [
        "# Tester brief", "",
        tdd ? "TDD is ON: write the failing test FIRST, then the code, then green." : "Write or extend tests alongside the change.",
        "1. Every behavior change has a test that fails without it.",
        "2. Cover the sad paths: invalid input, empty state, boundary values.",
        "3. Run the FULL suite after each significant change — never leave it red.",
        "4. No test deletion or skipping to get to green — fix the code.", "",
        "## Output",
        "Green suite + the list of new/changed tests and what each one pins.",
      ].join("\n");
    },
  },
  security: {
    purpose: "The security pass the brain absorbs — non-negotiable",
    render: () => [
      "# Security brief", "",
      "Checklist on EVERY diff (these findings are never overridable — not even by Solomon arbitration):",
      "1. Inputs: validate and sanitize anything user-controlled before it reaches HTML, shell, SQL or file paths (injection, XSS, traversal).",
      "2. Secrets: no keys, tokens or credentials in code, config, logs or commits.",
      "3. AuthN/AuthZ: every new endpoint/action checks identity AND permission.",
      "4. Dependencies: no new dependency without a reason; pin versions.",
      "5. Data: PII never logged; encryption for data at rest when the project does it elsewhere.", "",
      "## Output",
      "Findings with severity and file:line, or an explicit 'no security surface touched'.",
    ].join("\n"),
  },
  audit: {
    purpose: "Final look before shipping — does the whole thing hold?",
    render: () => [
      "# Audit brief", "",
      "Before declaring DONE:",
      "1. Re-read the done-statement from triage — is it literally true now?",
      "2. Diff review: no leftover debug code, TODOs without cards, or dead files.",
      "3. Docs: did behavior visible to users change? Update the minimal doc.",
      "4. The suite, lint and the review gate are green — verified, not assumed.", "",
      "## Output",
      "SHIP or a concrete must-fix list. Never 'ship with caveats'.",
    ].join("\n"),
  },
};

export const BRIEF_ROLES = Object.keys(B);

export function listBriefs() {
  return BRIEF_ROLES.map((role) => ({ role, purpose: B[role].purpose }));
}

export function renderBrief(role, config = {}) {
  const brief = B[role];
  if (!brief) {
    throw new Error(`unknown role "${role}" — available: ${BRIEF_ROLES.join(", ")}`);
  }
  return brief.render(config);
}

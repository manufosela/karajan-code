/**
 * Role briefs (AB-C, KJC-TSK-0652; outcome-first rewrite AB-C2,
 * KJC-TSK-0653) — the method of each role, exposed to the brain via
 * `kj brief <role>`.
 *
 * Format is Mission + Invariants + Deliverable, never step scripts:
 * frontier models choose better paths than a script would force, but they
 * need the hard limits explicit. The real guarantee lives in the git
 * gates, not in this text. Subprocess prompts stay in headless.
 */

const brief = (title, mission, invariants, deliverable) => [
  `# ${title} brief`, "",
  `Mission: ${mission}`, "",
  "Invariants:",
  ...invariants.map((i) => `- ${i}`), "",
  `Deliverable: ${deliverable}`,
].join("\n");

const B = {
  triage: {
    purpose: "Size the task before touching anything",
    render: () => brief("Triage",
      "before any code exists, the task has a type (sw|infra|doc|add-tests|refactor), an honest size, its risk surfaces named (auth, persistence, external I/O, money, PII), and a DONE-statement that is falsifiable.",
      [
        "The RAG answers before you assume (`kj rag query`) — never size from guesses.",
        "A task too big for one ~150-net-line PR is split into HUs BEFORE coding starts.",
      ],
      "type, size, risks, done-statement — or the HU split."),
  },
  planner: {
    purpose: "Turn the task into an ordered, committable plan",
    render: () => brief("Planner",
      "the smallest ordered plan whose steps each fit one commit, name their files, and reach the done-statement — with an explicit out-of-scope list.",
      [
        "Behavior changes carry their test in the same step.",
        "Data-model or API changes never share a step with anything else.",
        "No PR beyond ~150 net lines — partition upfront, not at the gate.",
        "Non-trivial task? Name at least two approaches — one as if the codebase didn't exist — and say why the winner won.",
      ],
      "numbered-free plan: steps {description, files}, risks, out-of-scope."),
  },
  researcher: {
    purpose: "Ground the task in how the codebase actually works",
    render: () => brief("Researcher",
      "the design starts from how this codebase actually does things: the existing pattern for this kind of change is found and mimicked, the load-bearing files and the tests that pin them are known.",
      [
        "Facts carry file:line references — a claim without one is a guess.",
        "Unknowns are listed explicitly, never papered over.",
      ],
      "grounded facts with references + the open unknowns."),
  },
  architect: {
    purpose: "Decide structure before code when the change is cross-cutting",
    render: () => brief("Architect",
      "for medium/complex changes, one design is chosen over named alternatives, existing ADRs and module boundaries are respected, and any data-model/API change has a migration and compatibility story.",
      [
        "Check the ADRs before deciding — never against an accepted one.",
        "Prefer the design that deletes code over the one that adds layers.",
        "One alternative answers: what would you build as if the codebase didn't exist? Picking the legacy-shaped path is fine — picking it by inertia is not.",
        "Ground that alternative in the canon: `kj rag query --library \"<problem signature>\"` serves distilled pattern cards with when-NOT-to-apply and citations.",
      ],
      "chosen design, discarded alternatives with reasons, affected boundaries."),
  },
  tester: {
    purpose: "Prove the change does what DONE says",
    render: (config) => {
      const tdd = config?.development?.methodology !== "standard";
      return brief("Tester",
        "every behavior change is pinned by a test that fails without it, sad paths included (invalid input, empty state, boundaries), and the FULL suite is green.",
        [
          ...(tdd ? ["TDD is ON: the failing test exists FIRST, then the code."] : []),
          "The suite is never left red, and never goes green by deleting or skipping tests.",
        ],
        "green suite + the list of new/changed tests and what each one pins.");
    },
  },
  security: {
    purpose: "The security pass the brain absorbs — non-negotiable",
    render: () => brief("Security",
      "when you finish, no user-controlled data reaches HTML, shell, SQL or file paths unsanitized; no secret, key or credential lives in code, config, logs or commits; and every new endpoint/action checks identity AND permission.",
      [
        "These findings are never overridable — not even by Solomon arbitration.",
        "PII is never logged; new dependencies need a reason and a pinned version.",
        "Sensitive surface (auth, user input, secrets, network, deps)? Self-invoke `kj audit --security` — deterministic, zero tokens: prompt-injection over the agent-context files + OSV + Semgrep + Sonar — and remediate the findings before requesting review.",
      ],
      "findings with severity, category and file:line — or an explicit 'no security surface touched'."),
  },
  board: {
    purpose: "What the HU Board is and how to act on it without breaking it",
    render: () => brief("Board",
      "the HU Board is the permanent record of work: every card traces to who created it and what happened to it — a dashboard warning is fixed with the command it names, never by rebuilding the board.",
      [
        "Before `kj hu add`, ALWAYS run `kj hu list`: if a card already covers the work (same scope, any plan), work THAT card instead of creating a twin.",
        "Cards are NEVER deleted or recreated — not to fix warnings, not to tidy up. Discard = `kj hu move <id> skipped` (archived, history kept).",
        "States move only via `kj hu move <id> <pending|running|done|failed|skipped>`.",
        "A duplicate short_id or title means the card already exists: update that card, never add a twin.",
        "A warning is information, not damage: run the command it names; if it looks like a kj bug, `kj report-issue` — never work around it by destroying state.",
      ],
      "the board reflects reality: the same cards before and after your action, with truthful states and provenance intact."),
  },
  audit: {
    purpose: "Final look before shipping — does the whole thing hold?",
    render: () => brief("Audit",
      "the done-statement from triage is literally true, the diff carries no debug leftovers or card-less TODOs, user-visible behavior changes have their minimal doc, and suite + lint + review gate are verified green.",
      [
        "Verified means you ran it — never assumed from an earlier state.",
        "There is no 'ship with caveats': it ships or it has a must-fix list.",
      ],
      "SHIP, or the concrete must-fix list."),
  },
};

export const BRIEF_ROLES = Object.keys(B);

export function listBriefs() {
  return BRIEF_ROLES.map((role) => ({ role, purpose: B[role].purpose }));
}

export function renderBrief(role, config = {}) {
  const entry = B[role];
  if (!entry) {
    throw new Error(`unknown role "${role}" — available: ${BRIEF_ROLES.join(", ")}`);
  }
  return entry.render(config);
}

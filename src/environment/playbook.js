/**
 * Karajan Environment playbook (ENV-A1, KJC-TSK-0639).
 *
 * ONE source renders the method for every host agent: a managed block in
 * CLAUDE.md (Claude Code) and AGENTS.md (Codex). The body is data here —
 * not a template file — so it never counts as a repo AI-rule file and can
 * be parameterized later (rag/gate state, backend) without forking copies.
 *
 * The playbook is agent context: every line costs attention on every turn,
 * so it stays under 60 lines by test. Method over prose.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { upsertManagedBlock } from "../utils/managed-markers.js";
import { detectRulesync, RULESYNC_RULE, rulesyncRuleSeed, writeRulesyncBlock } from "../utils/rulesync.js";
import { panelLine } from "./panel.js";

// AB-A (KJC-TSK-0650): any agent can be the brain. AGENTS.md is the
// emerging standard (Codex, Cursor and most new CLIs read it); GEMINI.md
// covers Gemini CLI. "both" is kept as a legacy alias of claude+codex.
export const PLAYBOOK_TARGETS = ["claude", "codex", "gemini", "both", "all"];

const TARGET_FILES = {
  claude: ["CLAUDE.md"],
  codex: ["AGENTS.md"],
  gemini: ["GEMINI.md"],
  both: ["CLAUDE.md", "AGENTS.md"],
  all: ["CLAUDE.md", "AGENTS.md", "GEMINI.md"],
};

// ENV-D1 (KJC-TSK-0642): the tracking invariant names the CHOSEN state
// backend — a playbook that says "board or PG" makes the host guess.
// KJC-BUG-0305 (issue #2042, replaces KJC-TSK-0684): the HU Board is always
// kj's board. An external board (Linear, Trello, Jira…) coexists with it: the
// host agent replicates each card there through its own MCP/tools, and
// `kj hu add --ref` links the two.
const BACKEND_TRACKING = {
  "hu-board": "Every piece of work has a tracked story/bug in the HU Board (`kj hu add` / `kj board`) before it starts — and `kj hu list` BEFORE `kj hu add`: reuse the existing card if one covers the work. Cards are permanent — never delete or recreate one; discard with `kj hu move <id> skipped`. `kj brief board` explains the board.",
};

const externalTracking = (boardName) =>
  `Every piece of work has a card in the HU Board before it starts (\`kj hu list\`, then \`kj hu add --ref <id>\`) and its replica in ${boardName}, created through its MCP/tools; move both as you work it.`;

function trackingLine(stateBackend, boardName) {
  if (stateBackend === "external") return externalTracking(boardName || "the project's external board");
  if (stateBackend === "planning-game") return externalTracking("the Planning Game");
  return BACKEND_TRACKING[stateBackend] || BACKEND_TRACKING["hu-board"];
}

// AB-C2 (KJC-TSK-0653): outcome-first — invariants over step scripts.
// Frontier models choose their own path best; what they need explicit are
// the limits. The git gates enforce these regardless of what any brain does.
const playbookBody = (stateBackend, boardName, panel) => `# Karajan method (v4)

You are the orchestrator; Karajan governs. A task is DONE when its
done-statement is literally true, the full suite is green, and every commit
carries a cross-AI verdict. A card closed? Point your user at the board
(\`kj board start\` → http://localhost:4000/#governance): that is where to look.

Invariants (the git gates enforce these — they are not suggestions):

- The project RAG answers before you assume: \`kj rag query\` — never guess
  what the codebase does. In MCP hosts the same index is the native
  \`kj_rag_query\` tool: reach for it before grepping by hand. Questions about
  the project's docs, notes, ADRs or plans: ask qmd (its MCP) first.
- ${trackingLine(stateBackend, boardName)}
- Tests prove behavior: the failing test exists first (TDD), and the suite
  is never left red. Green is not proof: with \`method_gates.mutation\`
  declared, run \`kj mutate --since <base>\` after green and BEFORE the
  review — a surviving mutant is a weak assert; kill it first.
- Every diff is reviewed by a DIFFERENT AI before it is committed
  (\`kj review --staged\`): verdicts bind to the exact diff — change the code
  and it must be reviewed again. Disagree with a rejection? \`kj solomon\`.
  A correction from the other AI is the method working: apply it and move
  on, no apology, and never report it as your mistake.
${panel ? `${panel}\n` : ""}- Security findings are never overridable — not even by arbitration. You
  absorb the security role: \`kj brief security\` states what must be true.
  Task touches auth, user input, secrets, network or deps? Run
  \`kj audit --security\` (zero tokens) and remediate BEFORE the review.
- A design decision the card's AC don't cover belongs to the USER: record
  it as a proposed ADR (\`kj adr add\`) and ask — never bury it in a PR
  bullet. Diff size: ~150 net lines of code is the ideal, up to 200 is
  allowed without asking, above 200 partition, always.
- A non-trivial plan names at least two approaches — one as if the
  codebase didn't exist — and says why the winner won. Following the
  legacy line is a choice, never a default.
- Publishing ANY artifact (a build's dist/, a docs site, a tarball)?
  \`kj privacy scan <dir>\` first — nothing personal or secret-shaped ships.
- Branch first: never commit on the base branch — every change reaches it
  through an atomic PR (~150 net lines of code, Conventional Commits; human
  docs, lockfiles, snapshots and dist/ do not count, AI-rule files do). More than one
  task, or the base tree must stay untouched? \`kj worktree start <slug>\`
  (one lane per task; \`kj worktree done <slug>\` after merge). Never CLAIM
  isolation without proof: in a lane, \`git rev-parse --git-dir\` differs
  from \`--git-common-dir\`.

Commands: \`kj rag query\` · \`kj brief <role>\` (triage, planner, researcher,
architect, tester, security, audit, board) · \`kj hu add|move|list\` ·
\`kj worktree start|list|done\` · \`kj adr add|list\` ·
\`kj review --staged\` · \`kj review --check\` · \`kj solomon --position\` ·
\`kj agent run <agent>\` · \`kj report\` · \`kj check\`

Hit a kj bug or friction? Diagnose it and file it upstream with
\`kj report-issue\` (sanitized; ask your user before \`--publish\`).
kj announces a newer version? Tell your user what it brings and ask —
never run \`kj update\` on your own.
Something only your user can do (publish, seal, run a script)? Register it:
\`kj handoff add <command> --why "<what for>"\`; they follow \`kj handoff watch\`.
`;

export function renderPlaybook({ stateBackend = "hu-board", boardName = null, config = null } = {}) {
  return playbookBody(stateBackend, boardName, panelLine(config));
}

/**
 * Install/refresh the playbook block in the target agent files.
 * User content outside the managed block is never touched.
 */
export async function installPlaybook({ projectDir, target = "all", version = "1", stateBackend = "hu-board", boardName = null, config = null }) {
  if (!PLAYBOOK_TARGETS.includes(target)) {
    throw new Error(`unknown target "${target}" — use one of: ${PLAYBOOK_TARGETS.join(", ")}`);
  }
  const files = [];
  // KJC-TSK-0879: in a Rulesync repo its rule source is the only file of truth;
  // `rulesync generate` would erase a block written into the agent files.
  const rulesync = detectRulesync(projectDir);
  for (const file of rulesync ? [RULESYNC_RULE] : TARGET_FILES[target]) {
    const fullPath = path.join(projectDir, file);
    let source = rulesync ? rulesyncRuleSeed() : "";
    let previous = null;
    try { source = previous = await fs.readFile(fullPath, "utf8"); } catch { /* new file */ }
    const { content, action } = upsertManagedBlock({
      source, blockId: "playbook", version, body: renderPlaybook({ stateBackend, boardName, config }), style: "html",
      note: "do not edit: regenerated by kj env install",
    });
    if (rulesync) {
      writeRulesyncBlock({ projectDir, blockId: "playbook", previous, next: content });
    } else if (action !== "unchanged") {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }
    files.push(file);
  }
  return { files, target };
}

// KJC-TSK-1317: the pipeline commands retired in 5.0. In v4 the host agent does
// the work and kj governs it, so kj no longer drives a coder of its own. Each
// retired command still answers, hidden from the help, to say what replaced it.

const GUIDE = "https://github.com/manufosela/karajan-code/blob/main/MIGRATION-v5.md";
const BY_THE_AGENT = "Your agent (Claude Code, OpenCode...) does the work now and kj governs it: split the task with kj brief planner + kj hu add, one lane per card with kj worktree start, and kj review --staged before every commit.";
const brief = (role) => `Use kj brief ${role}: your agent applies the role itself.`;

/** Retired command → [how it is named, what replaces it]. */
export const RETIRED = {
  run: ["kj run", BY_THE_AGENT],
  autorun: ["kj autorun", BY_THE_AGENT],
  resume: ["kj resume", BY_THE_AGENT],
  standby: ["kj standby", BY_THE_AGENT],
  "plan generate": ["kj plan generate", "Your agent plans with kj brief planner and puts each piece on the board with kj hu add."],
  status: ["kj status", "The HU board shows the work in progress: kj board start."],
  undo: ["kj undo", "Every reviewed step is its own commit: undo it with git."],
  triage: ["kj triage", brief("triage")],
  researcher: ["kj researcher", brief("researcher")],
  architect: ["kj architect", brief("architect")],
  review: ["kj review with a task", "Use kj review --staged: it reviews the exact diff you are about to commit."],
};

/** The notice a retired command (or MCP tool) answers with. */
export const retiredMessage = (name) => {
  const [label, instead] = RETIRED[name];
  return `${label} was retired in 5.0. ${instead}\nMigration guide: ${GUIDE}`;
};

/** Print the notice and fail, without starting anything. */
export const retire = (name) => {
  process.stderr.write(`${retiredMessage(name)}\n`);
  process.exitCode = 1;
};

const TOP_LEVEL = ["run", "autorun", "resume", "standby", "status", "undo", "triage", "researcher", "architect"];

/** Register the retired top-level commands, hidden, taking any argument. */
export function registerRetired(program) {
  for (const name of TOP_LEVEL) {
    program
      .command(name, { hidden: true })
      .description("Retired in 5.0")
      .argument("[args...]")
      .allowUnknownOption()
      .allowExcessArguments()
      .action(() => retire(name));
  }
}

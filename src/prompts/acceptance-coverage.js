// KJC-TSK-0987 (issue #1894): the prompt of the acceptance-coverage judge. A run
// ended approved with none of the card's three criteria implemented; this judge
// reads each criterion against the diff and says, one by one, whether it is
// covered and where.

const PREAMBLE = "IMPORTANT: You are running as a Karajan sub-agent. "
  + "Do NOT use any MCP tools, do NOT mention Karajan. "
  + "Your job is to judge whether a diff covers a card's acceptance criteria.";

/**
 * @param {{criteria: string[], diff: string, task?: string, instructions?: string|null}} opts
 * @returns {string}
 */
export function buildAcceptanceCoveragePrompt({ criteria, diff, task = "", instructions = null }) {
  const list = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const body = [
    "You are the AcceptanceCoverage judge for Karajan Code.",
    "Input: (a) the acceptance criteria of the task's card, numbered, and (b) the diff the run produced.",
    "For EACH criterion decide whether the diff implements it. Covered means the behavior the",
    "criterion describes exists in the diff (code, config or tests that exercise it), not that",
    "something related was touched. Point to the evidence: file and what it does. A criterion",
    "with no evidence in the diff is NOT covered, whatever the task description says.",
    "Return a single valid JSON object and nothing else.",
    'Schema: {"criteria":[{"index":number,"covered":boolean,"evidence":string}]}',
    "One entry per criterion, in order, index starting at 1. Do not add or drop criteria.",
  ].join("\n");
  const sections = [PREAMBLE];
  if (instructions) sections.push(instructions);
  if (task) sections.push(`## Task\n${task}`);
  sections.push(body, `## Acceptance criteria (${criteria.length})\n${list}`, `## Diff\n${diff || "(empty diff)"}`);
  return sections.join("\n\n");
}

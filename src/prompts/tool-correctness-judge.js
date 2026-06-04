// KJC-TSK-0375 — Prompt builder for the ToolCorrectnessJudge role.
// Inspired by deepeval's tool-correctness metric.

const PREAMBLE = "IMPORTANT: You are running as a Karajan sub-agent. "
  + "Do NOT use any MCP tools, do NOT mention Karajan. "
  + "Your job is to judge another agent's tool choices.";

export function buildToolCorrectnessJudgePrompt({ task, toolCalls, instructions }) {
  const calls = toolCalls
    .map((c, i) => `${i + 1}. **${c.tool}** — args: ${JSON.stringify(c.args)}`)
    .join("\n");
  const body = [
    "You are the ToolCorrectnessJudge for Karajan Code.",
    "Input: (a) a task description and (b) the ordered tool calls an LLM coder",
    "made (Read/Edit/Write/Bash/Glob/Grep/MultiEdit). Judge each call on:",
    "  - tool choice: right tool for the intent?",
    "  - argument quality: paths plausible, commands valid, no garbage placeholders?",
    "Per-call verdict: `correct=true|false` + one-sentence `reason`.",
    "Aggregate into a single 0-100 score:",
    "  - 100 = every call right with clean args",
    "  - 70-99 = mostly right, minor missteps",
    "  - 40-69 = several wrong choices, budget wasted",
    "  - 0-39 = predominantly bad, retry advised",
    "Return a single valid JSON object and nothing else.",
    'Schema: {"score":0-100,"summary":string,"breakdown":[{"tool":string,"args":object,"correct":boolean,"reason":string}]}',
  ].join("\n");
  const sections = [PREAMBLE];
  if (instructions) sections.push(instructions);
  sections.push(body, `## Task\n${task}`, `## Tool calls (${toolCalls.length})\n${calls || "(no tool calls captured)"}`);
  return sections.join("\n\n");
}

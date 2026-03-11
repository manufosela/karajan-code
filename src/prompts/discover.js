const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on discovering gaps in the task specification."
].join(" ");

export const DISCOVER_MODES = ["gaps", "momtest", "wendel"];

const VALID_VERDICTS = ["ready", "needs_validation"];
const VALID_SEVERITIES = ["critical", "major", "minor"];
const VALID_WENDEL_STATUSES = ["pass", "fail", "unknown", "not_applicable"];

export function buildDiscoverPrompt({ task, instructions, mode = "gaps", context = null }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "You are a task discovery agent for Karajan Code, a multi-agent coding orchestrator.",
    "Analyze the following task and identify gaps, ambiguities, missing information, and implicit assumptions."
  );

  sections.push(
    "## Gap Detection Guidelines",
    [
      "- Look for missing acceptance criteria or requirements",
      "- Identify implicit assumptions that need explicit confirmation",
      "- Find ambiguities where multiple interpretations exist",
      "- Check for contradictions between different parts of the spec",
      "- Consider edge cases and error scenarios not addressed",
      "- Classify each gap by severity: critical (blocks implementation), major (could cause rework), minor (reasonable default exists)"
    ].join("\n")
  );

  if (mode === "momtest") {
    sections.push(
      "## Mom Test Rules",
      [
        "For each gap, generate questions that follow The Mom Test principles:",
        "- ALWAYS ask about past behavior and real experiences, never hypothetical scenarios",
        "- NEVER ask 'Would you...?', 'Do you think...?', 'Would it be useful if...?'",
        "- ALWAYS ask 'When was the last time...?', 'How do you currently...?', 'What happened when...?'",
        "- Ask about specifics, not generalities",
        "- Each question must have a targetRole (who to ask) and rationale (why this matters)",
        "",
        "Examples of BAD questions (hypothetical/opinion):",
        "  - 'Would you use this feature?' -> opinion, not data",
        "  - 'Do you think users need this?' -> speculation",
        "",
        "Examples of GOOD questions (past behavior):",
        "  - 'When was the last time you had to do X manually?' -> real experience",
        "  - 'How are you currently handling Y?' -> current behavior",
        "  - 'What happened the last time Z failed?' -> real consequence"
      ].join("\n")
    );
  }

  if (mode === "wendel") {
    sections.push(
      "## Wendel Behavior Change Checklist",
      [
        "Evaluate whether the task implies a user behavior change. If it does, assess these 5 conditions:",
        "",
        "1. **CUE** — Is there a clear trigger that will prompt the user to take the new action?",
        "2. **REACTION** — Will the user have a positive emotional reaction when they encounter the cue?",
        "3. **EVALUATION** — Can the user quickly understand the value of the new behavior?",
        "4. **ABILITY** — Does the user have the skill and resources to perform the new behavior?",
        "5. **TIMING** — Is this the right moment to introduce this change?",
        "",
        "For each condition, set status to: pass, fail, unknown, or not_applicable",
        "If the task does NOT imply behavior change (e.g., internal refactor, backend optimization), set ALL conditions to 'not_applicable'",
        "If ANY condition is 'fail', set verdict to 'needs_validation'"
      ].join("\n")
    );
  }

  const baseSchema = '{"verdict":"ready|needs_validation","gaps":[{"id":string,"description":string,"severity":"critical|major|minor","suggestedQuestion":string}]';
  const momtestSchema = mode === "momtest"
    ? ',"momTestQuestions":[{"gapId":string,"question":string,"targetRole":string,"rationale":string}]'
    : "";
  const wendelSchema = mode === "wendel"
    ? ',"wendelChecklist":[{"condition":"CUE|REACTION|EVALUATION|ABILITY|TIMING","status":"pass|fail|unknown|not_applicable","justification":string}]'
    : "";

  sections.push(
    "Return a single valid JSON object and nothing else.",
    `JSON schema: ${baseSchema}${momtestSchema}${wendelSchema},"summary":string}`
  );

  if (context) {
    sections.push(`## Context\n${context}`);
  }

  sections.push(`## Task\n${task}`);

  return sections.join("\n\n");
}

export function parseDiscoverOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  const verdict = VALID_VERDICTS.includes(parsed.verdict) ? parsed.verdict : "ready";

  const rawGaps = Array.isArray(parsed.gaps) ? parsed.gaps : [];
  const gaps = rawGaps
    .filter((g) => g && g.id && g.description && g.suggestedQuestion)
    .map((g) => ({
      id: g.id,
      description: g.description,
      severity: VALID_SEVERITIES.includes(String(g.severity).toLowerCase())
        ? String(g.severity).toLowerCase()
        : "major",
      suggestedQuestion: g.suggestedQuestion
    }));

  const rawQuestions = Array.isArray(parsed.momTestQuestions) ? parsed.momTestQuestions : [];
  const momTestQuestions = rawQuestions
    .filter((q) => q && q.gapId && q.question && q.targetRole && q.rationale)
    .map((q) => ({
      gapId: q.gapId,
      question: q.question,
      targetRole: q.targetRole,
      rationale: q.rationale
    }));

  const rawChecklist = Array.isArray(parsed.wendelChecklist) ? parsed.wendelChecklist : [];
  const wendelChecklist = rawChecklist
    .filter((c) => c && c.condition && c.justification && c.status)
    .map((c) => ({
      condition: c.condition,
      status: VALID_WENDEL_STATUSES.includes(String(c.status).toLowerCase())
        ? String(c.status).toLowerCase()
        : "unknown",
      justification: c.justification
    }));

  return {
    verdict,
    gaps,
    momTestQuestions,
    wendelChecklist,
    summary: parsed.summary || ""
  };
}

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on discovering gaps in the task specification."
].join(" ");

export const DISCOVER_MODES = ["gaps"];

const VALID_VERDICTS = ["ready", "needs_validation"];
const VALID_SEVERITIES = ["critical", "major", "minor"];

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

  sections.push(
    "Return a single valid JSON object and nothing else.",
    'JSON schema: {"verdict":"ready|needs_validation","gaps":[{"id":string,"description":string,"severity":"critical|major|minor","suggestedQuestion":string}],"summary":string}'
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

  return {
    verdict,
    gaps,
    summary: parsed.summary || ""
  };
}

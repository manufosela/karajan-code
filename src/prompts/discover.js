import { extractFirstJson } from "../utils/json-extract.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on discovering gaps in the task specification."
].join(" ");

export const DISCOVER_MODES = ["gaps", "momtest", "wendel", "classify", "jtbd"];

const VALID_VERDICTS = new Set(["ready", "needs_validation"]);
const VALID_SEVERITIES = new Set(["critical", "major", "minor"]);
const VALID_WENDEL_STATUSES = new Set(["pass", "fail", "unknown", "not_applicable"]);
const VALID_CLASSIFY_TYPES = new Set(["START", "STOP", "DIFFERENT", "not_applicable"]);
const VALID_ADOPTION_RISKS = new Set(["none", "low", "medium", "high"]);

export function buildDiscoverPrompt({ task, instructions, mode = "gaps", context = null }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "You are a task discovery agent for Karajan Code, a multi-agent coding orchestrator.",
    "Analyze the following task and identify gaps, ambiguities, missing information, and implicit assumptions.",
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

  if (mode === "classify") {
    sections.push(
      "## Behavior Change Classification",
      [
        "Classify the task by its impact on user behavior:",
        "",
        "- **START**: User must adopt a completely new behavior or workflow",
        "- **STOP**: User must stop doing something they currently do (highest resistance risk)",
        "- **DIFFERENT**: User must do something they already do, but differently",
        "- **not_applicable**: Task has no user behavior impact (internal refactor, backend, infra)",
        "",
        "Assess adoption risk: none (no user impact), low, medium, high",
        "STOP changes carry the highest risk of resistance — always flag them",
        "Provide a frictionEstimate explaining the expected friction"
      ].join("\n")
    );
  }

  if (mode === "jtbd") {
    sections.push(
      "## Jobs-to-be-Done Framework",
      [
        "Generate reinforced Jobs-to-be-Done from the task and any provided context (interview notes, field observations).",
        "Each JTBD must include 5 layers:",
        "",
        "- **functional**: The practical job the user is trying to accomplish",
        "- **emotionalPersonal**: How the user wants to feel personally",
        "- **emotionalSocial**: How the user wants to be perceived by others",
        "- **behaviorChange**: Type of change: START, STOP, DIFFERENT, or not_applicable",
        "- **evidence**: Direct quotes or specific references from the context. If no context provided, set to 'not_available' and suggest what context is needed",
        "",
        "CRITICAL: evidence must contain real quotes or references from the provided context, NEVER invented assumptions",
        "If no context is provided, mark evidence as 'not_available'"
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
  const classifySchema = mode === "classify"
    ? ',"classification":{"type":"START|STOP|DIFFERENT|not_applicable","adoptionRisk":"none|low|medium|high","frictionEstimate":string}'
    : "";
  const jtbdSchema = mode === "jtbd"
    ? ',"jtbds":[{"id":string,"functional":string,"emotionalPersonal":string,"emotionalSocial":string,"behaviorChange":"START|STOP|DIFFERENT|not_applicable","evidence":string}]'
    : "";

  sections.push(
    "Return a single valid JSON object and nothing else.",
    `JSON schema: ${baseSchema}${momtestSchema}${wendelSchema}${classifySchema}${jtbdSchema},"summary":string}`
  );

  if (context) {
    sections.push(`## Context\n${context}`);
  }

  sections.push(`## Task\n${task}`);

  return sections.join("\n\n");
}

function parseClassification(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rawType = String(raw.type || "").toUpperCase();
  let type;
  if (rawType === "NOT_APPLICABLE") type = "not_applicable";
  else if (VALID_CLASSIFY_TYPES.has(rawType)) type = rawType;
  else type = "not_applicable";
  const rawRisk = String(raw.adoptionRisk || "").toLowerCase();
  return {
    type,
    adoptionRisk: VALID_ADOPTION_RISKS.has(rawRisk) ? rawRisk : "medium",
    frictionEstimate: raw.frictionEstimate || ""
  };
}

function parseGaps(rawGaps) {
  return (Array.isArray(rawGaps) ? rawGaps : [])
    .filter((g) => g?.id && g.description && g.suggestedQuestion)
    .map((g) => ({
      id: g.id,
      description: g.description,
      severity: VALID_SEVERITIES.has(String(g.severity).toLowerCase())
        ? String(g.severity).toLowerCase()
        : "major",
      suggestedQuestion: g.suggestedQuestion
    }));
}

function parseMomTestQuestions(rawQuestions) {
  return (Array.isArray(rawQuestions) ? rawQuestions : [])
    .filter((q) => q?.gapId && q.question && q.targetRole && q.rationale)
    .map((q) => ({
      gapId: q.gapId,
      question: q.question,
      targetRole: q.targetRole,
      rationale: q.rationale
    }));
}

function parseWendelChecklist(rawChecklist) {
  return (Array.isArray(rawChecklist) ? rawChecklist : [])
    .filter((c) => c?.condition && c.justification && c.status)
    .map((c) => ({
      condition: c.condition,
      status: VALID_WENDEL_STATUSES.has(String(c.status).toLowerCase())
        ? String(c.status).toLowerCase()
        : "unknown",
      justification: c.justification
    }));
}

function parseJtbds(rawJtbds) {
  return (Array.isArray(rawJtbds) ? rawJtbds : [])
    .filter((j) => j?.id && j.functional && j.emotionalPersonal && j.emotionalSocial && j.behaviorChange && j.evidence)
    .map((j) => ({
      id: j.id,
      functional: j.functional,
      emotionalPersonal: j.emotionalPersonal,
      emotionalSocial: j.emotionalSocial,
      behaviorChange: j.behaviorChange,
      evidence: j.evidence
    }));
}

export function parseDiscoverOutput(raw) {
  const parsed = extractFirstJson(raw);
  if (!parsed) return null;

  return {
    verdict: VALID_VERDICTS.has(parsed.verdict) ? parsed.verdict : "ready",
    gaps: parseGaps(parsed.gaps),
    momTestQuestions: parseMomTestQuestions(parsed.momTestQuestions),
    wendelChecklist: parseWendelChecklist(parsed.wendelChecklist),
    classification: parseClassification(parsed.classification),
    jtbds: parseJtbds(parsed.jtbds),
    summary: parsed.summary || ""
  };
}

import { loadAvailableSkills, buildSkillSection } from "../skills/skill-loader.js";
import { getLanguageInstruction } from "../utils/locale.js";
import { section, buildPromptLayout, joinLayout, STABLE, VOLATILE } from "./prompt-layout.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on designing the architecture for the task."
].join(" ");

export const VALID_VERDICTS = new Set(["ready", "needs_clarification"]);

/**
 * Build the architect prompt as a { stable, volatile } layout (Φ1,
 * KJC-PCS-0057): instructions, guidelines, schema, contexts and skills
 * are identical across invocations on the same project; research
 * context and the task itself go last.
 */
export async function buildArchitectPromptLayout({ task, instructions, researchContext = null, productContext = null, domainContext = null, projectDir = null, language = "en", provider = null }) {
  const langInstruction = getLanguageInstruction(language);
  let skillSection = null;
  if (projectDir) {
    const skills = await loadAvailableSkills(projectDir);
    skillSection = buildSkillSection(skills, { provider, role: "architect" });
  }

  return buildPromptLayout([
    section(SUBAGENT_PREAMBLE, STABLE),
    section(langInstruction, STABLE),
    section(instructions, STABLE),
    section("You are the architect in a multi-role AI pipeline.", STABLE),
    section("Analyze the task and produce a concrete architecture design including layers, patterns, data model, API contracts, dependencies, and tradeoffs.", STABLE),
    section("## Architecture Guidelines", STABLE),
    section([
      "- Identify the architecture type (layered, microservices, event-driven, etc.)",
      "- Define the layers and their responsibilities",
      "- Identify design patterns to apply",
      "- Define the data model with entities",
      "- Specify API contracts (endpoints, events, interfaces)",
      "- List external and internal dependencies",
      "- Document tradeoffs and their rationale",
      "- If critical decisions cannot be made without more information, list clarifying questions"
    ].join("\n"), STABLE),
    section("Return a single valid JSON object and nothing else.", STABLE),
    section('JSON schema: {"verdict":"ready|needs_clarification","architecture":{"type":string,"layers":[string],"patterns":[string],"dataModel":{"entities":[string]},"apiContracts":[string],"dependencies":[string],"tradeoffs":[string]},"questions":[string],"summary":string}', STABLE),
    section(productContext ? `## Product Context\n${productContext}` : null, STABLE),
    section(domainContext ? `## Domain Context\n${domainContext}` : null, STABLE),
    section(skillSection, STABLE),
    section(researchContext ? `## Research Context\n${researchContext}` : null, VOLATILE),
    section(`## Task\n${task}`, VOLATILE),
  ]);
}

export async function buildArchitectPrompt(options) {
  return joinLayout(await buildArchitectPromptLayout(options));
}

function filterStrings(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((item) => typeof item === "string");
}

export function parseArchitectOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) return null;

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch { /* architect output is not valid JSON */
    return null;
  }

  const verdict = VALID_VERDICTS.has(parsed.verdict)
    ? parsed.verdict
    : "needs_clarification";

  const arch = parsed.architecture && typeof parsed.architecture === "object"
    ? parsed.architecture
    : {};

  const dataModel = arch.dataModel && typeof arch.dataModel === "object"
    ? arch.dataModel
    : {};

  return {
    verdict,
    architecture: {
      type: typeof arch.type === "string" ? arch.type : "",
      layers: filterStrings(arch.layers),
      patterns: filterStrings(arch.patterns),
      dataModel: {
        entities: filterStrings(dataModel.entities)
      },
      apiContracts: filterStrings(arch.apiContracts),
      dependencies: filterStrings(arch.dependencies),
      tradeoffs: filterStrings(arch.tradeoffs)
    },
    questions: filterStrings(parsed.questions),
    summary: parsed.summary || ""
  };
}

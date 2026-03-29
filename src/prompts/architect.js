import { loadAvailableSkills, buildSkillSection } from "../skills/skill-loader.js";
import { getLanguageInstruction } from "../utils/locale.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on designing the architecture for the task."
].join(" ");

export const VALID_VERDICTS = new Set(["ready", "needs_clarification"]);

export async function buildArchitectPrompt({ task, instructions, researchContext = null, productContext = null, projectDir = null, language = "en" }) {
  const langInstruction = getLanguageInstruction(language);
  const sections = [SUBAGENT_PREAMBLE, ...(langInstruction ? [langInstruction] : [])];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "You are the architect in a multi-role AI pipeline.",
    "Analyze the task and produce a concrete architecture design including layers, patterns, data model, API contracts, dependencies, and tradeoffs.",
    "## Architecture Guidelines",
    [
      "- Identify the architecture type (layered, microservices, event-driven, etc.)",
      "- Define the layers and their responsibilities",
      "- Identify design patterns to apply",
      "- Define the data model with entities",
      "- Specify API contracts (endpoints, events, interfaces)",
      "- List external and internal dependencies",
      "- Document tradeoffs and their rationale",
      "- If critical decisions cannot be made without more information, list clarifying questions"
    ].join("\n"),
    "Return a single valid JSON object and nothing else.",
    'JSON schema: {"verdict":"ready|needs_clarification","architecture":{"type":string,"layers":[string],"patterns":[string],"dataModel":{"entities":[string]},"apiContracts":[string],"dependencies":[string],"tradeoffs":[string]},"questions":[string],"summary":string}'
  );

  if (productContext) {
    sections.push(`## Product Context\n${productContext}`);
  }

  if (researchContext) {
    sections.push(`## Research Context\n${researchContext}`);
  }

  sections.push(`## Task\n${task}`);

  if (projectDir) {
    const skills = await loadAvailableSkills(projectDir);
    const skillSection = buildSkillSection(skills);
    if (skillSection) {
      sections.push(skillSection);
    }
  }

  return sections.join("\n\n");
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
  } catch {
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

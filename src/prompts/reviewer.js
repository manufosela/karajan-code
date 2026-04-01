import { buildRtkInstructions } from "./rtk-snippet.js";
import { loadAvailableSkills, buildSkillSection } from "../skills/skill-loader.js";
import { getLanguageInstruction } from "../utils/locale.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on reviewing the code."
].join(" ");

const SUBAGENT_PREAMBLE_SERENA = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Focus only on reviewing the code."
].join(" ");

const SERENA_INSTRUCTIONS = [
  "## Serena MCP — symbol-level code navigation",
  "You have access to Serena MCP tools for efficient code review.",
  "Use these to verify context without reading entire files:",
  "- `find_symbol(name)` — locate a function, class, or variable definition",
  "- `find_referencing_symbols(name)` — find all callers/references of a symbol",
  "Use Serena to check how changed symbols are used across the codebase.",
  "Fall back to reading files only when Serena tools are not sufficient."
].join("\n");

export async function buildReviewerPrompt({ task, diff, reviewRules, mode, serenaEnabled = false, rtkAvailable = false, proxyEnabled = false, productContext = null, domainContext = null, projectDir = null, language = "en" }) {
  const truncatedDiff = diff.length > 12000 ? `${diff.slice(0, 12000)}\n\n[TRUNCATED]` : diff;

  const langInstruction = getLanguageInstruction(language);
  const sections = [
    serenaEnabled ? SUBAGENT_PREAMBLE_SERENA : SUBAGENT_PREAMBLE,
    ...(langInstruction ? [langInstruction] : []),
    `You are a code reviewer in ${mode} mode.`,
    "CRITICAL SCOPE RULE: Only review changes that are part of the diff below. Do NOT flag issues in unchanged code, missing features planned for future tasks, or improvements outside the scope of this task. If the diff is correct for what the task asks, approve it — even if the broader codebase has other issues.",
    "Only block approval for issues IN THE DIFF that are bugs, security vulnerabilities, or clear violations of the review rules.",
    "Return only one valid JSON object and nothing else.",
    "JSON schema:",
    '{"approved":boolean,"blocking_issues":[{"id":string,"severity":"critical|high|medium|low","file":string,"line":number,"description":string,"suggested_fix":string}],"non_blocking_suggestions":[string],"summary":string,"confidence":number}'
  ];

  if (serenaEnabled) {
    sections.push(SERENA_INSTRUCTIONS);
  }

  const rtkSnippet = buildRtkInstructions({ rtkAvailable, proxyEnabled });
  if (rtkSnippet) {
    sections.push(rtkSnippet);
  }

  if (productContext) {
    sections.push(`## Product Context\n${productContext}`);
  }

  if (domainContext) {
    sections.push(`## Domain Context\n${domainContext}`);
  }

  sections.push(
    `Task context:\n${task}`,
    `Review rules:\n${reviewRules}`,
    `Git diff:\n${truncatedDiff}`
  );

  if (projectDir) {
    const skills = await loadAvailableSkills(projectDir);
    const skillSection = buildSkillSection(skills);
    if (skillSection) {
      sections.push(skillSection);
    }
  }

  return sections.join("\n\n");
}

import { buildRtkInstructions } from "./rtk-snippet.js";
import { loadAvailableSkills, buildSkillSection } from "../skills/skill-loader.js";
import { getLanguageInstruction } from "../utils/locale.js";
import { section, buildPromptLayout, joinLayout, STABLE, VOLATILE } from "./prompt-layout.js";
import { clipDiff } from "./diff-clip.js";
import { buildSplitSignal } from "./split-signal.js";

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

/**
 * Build the reviewer prompt as a { stable, volatile } layout (Φ1,
 * KJC-PCS-0057). The stable block (preamble, mode, scope rules, JSON
 * schema, serena/rtk, contexts, review rules, skills) is identical
 * across reviews of the same project, so prefix-caching providers hit
 * on it; the per-review content (task context + git diff, up to 12 KB
 * and always different) goes last.
 */
export async function buildReviewerPromptLayout({ task, diff, reviewRules, mode, serenaEnabled = false, rtkAvailable = false, productContext = null, domainContext = null, projectDir = null, language = "en", provider = null }) {
  const { body: clippedDiff, note: clipNote } = clipDiff(diff);
  // KJC-BUG-0138: computed on the FULL diff — the moved-to side must inform
  // the reviewer even when the clipped copy no longer shows it.
  const splitSignal = buildSplitSignal(diff);

  const langInstruction = getLanguageInstruction(language);
  const rtkSnippet = buildRtkInstructions({ rtkAvailable });
  let skillSection = null;
  if (projectDir) {
    const skills = await loadAvailableSkills(projectDir);
    skillSection = buildSkillSection(skills, { provider, role: "reviewer" });
  }

  return buildPromptLayout([
    section(serenaEnabled ? SUBAGENT_PREAMBLE_SERENA : SUBAGENT_PREAMBLE, STABLE),
    section(langInstruction, STABLE),
    section(`You are a code reviewer in ${mode} mode.`, STABLE),
    section("CRITICAL SCOPE RULE: Only review changes that are part of the diff below. Do NOT flag issues in unchanged code, missing features planned for future tasks, or improvements outside the scope of this task. If the diff is correct for what the task asks, approve it — even if the broader codebase has other issues.", STABLE),
    section("Only block approval for issues IN THE DIFF that are bugs, security vulnerabilities, or clear violations of the review rules.", STABLE),
    section("Return only one valid JSON object and nothing else.", STABLE),
    section("JSON schema:", STABLE),
    section('{"approved":boolean,"blocking_issues":[{"id":string,"severity":"critical|high|medium|low","category":"security|correctness|performance|style|other","file":string,"line":number,"description":string,"suggested_fix":string}],"non_blocking_suggestions":[string],"summary":string,"confidence":number}', STABLE),
    section(serenaEnabled ? SERENA_INSTRUCTIONS : null, STABLE),
    section(rtkSnippet, STABLE),
    section(productContext ? `## Product Context\n${productContext}` : null, STABLE),
    section(domainContext ? `## Domain Context\n${domainContext}` : null, STABLE),
    section(`Review rules:\n${reviewRules}`, STABLE),
    section(skillSection, STABLE),
    section(`Task context:\n${task}`, VOLATILE),
    section(`Git diff:\n${clippedDiff}`, VOLATILE),
    section(clipNote, VOLATILE),
    section(splitSignal, VOLATILE),
  ]);
}

export async function buildReviewerPrompt(options) {
  return joinLayout(await buildReviewerPromptLayout(options));
}

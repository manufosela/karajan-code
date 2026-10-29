import { buildRtkInstructions } from "./rtk-snippet.js";
import { roleSkills, buildRoleSkillSection } from "../skills/role-skills.js";
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
export async function buildReviewerPromptLayout({ task, diff, reviewRules, mode, serenaEnabled = false, rtkAvailable = false, productContext = null, domainContext = null, projectDir = null, language = "en", provider = null, roleSkillBlock = null }) {
  const { body: clippedDiff, note: clipNote } = clipDiff(diff);
  // KJC-BUG-0138: full diff on purpose — the moved-to side survives clipping.
  const splitSignal = buildSplitSignal(diff);

  const langInstruction = getLanguageInstruction(language);
  const rtkSnippet = buildRtkInstructions({ rtkAvailable });
  // KJC-TSK-1065: the reviewer gets the skills of its role and of the task, up to 3.
  let skillSection = null;
  // KJC-TSK-1272: a block the caller resolved (a third-party repo's stack) wins over the project's.
  if (roleSkillBlock) {
    skillSection = buildRoleSkillSection(roleSkillBlock, { provider }) || null;
  } else if (projectDir) {
    skillSection = buildRoleSkillSection(await roleSkills({ role: "reviewer", task, projectDir }), { provider }) || null;
  }

  return buildPromptLayout([
    section(serenaEnabled ? SUBAGENT_PREAMBLE_SERENA : SUBAGENT_PREAMBLE, STABLE),
    section(langInstruction, STABLE),
    section(`You are a code reviewer in ${mode} mode.`, STABLE),
    section("CRITICAL SCOPE RULE: Only review changes that are part of the diff below. Do NOT flag issues in unchanged code, missing features planned for future tasks, or improvements outside the scope of this task. If the diff is correct for what the task asks, approve it — even if the broader codebase has other issues.", STABLE),
    section("Only block approval for issues IN THE DIFF that are bugs, security vulnerabilities, or clear violations of the review rules.", STABLE),
    // KJC-BUG-0369 (#2196): a reviewer blocked GitHub's on.schedule timezone, which exists.
    section("A claim that a tool, platform or API does not support something the diff uses is not a blocking issue on its own: your training data may predate the feature. Block only when the diff or the task context shows it fails; otherwise put it in non_blocking_suggestions.", STABLE),
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

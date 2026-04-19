import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SKILL_DIRS = [".agent/skills", ".claude/skills"];
const SKILL_FILE = "SKILL.md";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Extract the `type` field from SKILL.md frontmatter.
 * Returns "technical" (default) or "domain".
 * @param {string} content — raw SKILL.md content
 * @returns {{type: string, body: string}}
 */
function parseSkillType(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { type: "technical", body: content };

  const frontmatter = match[1];
  const body = match[2];

  // Simple regex extraction — avoid full YAML parser for a single field
  const typeMatch = frontmatter.match(/^type:\s*(.+)$/m);
  const type = typeMatch ? typeMatch[1].trim().toLowerCase() : "technical";

  return { type, body };
}

/**
 * Scans known skill directories for SKILL.md files.
 * @param {string} projectDir — absolute path to the project root
 * @param {{type?: string}} [options] — filter by type: "technical" (default), "domain", or undefined (all)
 * @returns {Promise<Array<{name: string, content: string, type: string}>>}
 */
export async function loadAvailableSkills(projectDir, options = {}) {
  const skills = [];
  const filterType = options.type || null;

  for (const rel of SKILL_DIRS) {
    const dir = join(projectDir, rel);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // directory does not exist — skip
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(dir, entry.name, SKILL_FILE);
      try {
        const raw = await readFile(skillPath, "utf-8");
        const { type, body } = parseSkillType(raw);

        // Filter by type if specified
        if (filterType && type !== filterType) continue;

        // For backward compat: existing callers get content without frontmatter for domain skills,
        // but full content for technical skills (they never had frontmatter before)
        const content = type === "domain" ? body.trim() : raw;
        skills.push({ name: entry.name, content, type });
      } catch {
        // no SKILL.md in this subdirectory — skip
      }
    }
  }

  return skills;
}

/**
 * Builds a prompt section from loaded skills.
 *
 * For Anthropic (Claude Sonnet 4.5+), skills are delivered as Agent Skills
 * natively (loaded by the runtime from SKILL.md) — duplicating their full
 * content in the prompt wastes tokens and risks drifting from the canonical
 * source. When `provider === "anthropic"`, this function emits a lightweight
 * reference list; Claude will load the SKILL.md files on demand.
 *
 * For every other provider, the full SKILL.md body is inlined (previous
 * behaviour preserved).
 *
 * @param {Array<{name: string, content: string}>} skills
 * @param {{ provider?: string }} [options]
 * @returns {string} prompt section or empty string
 */
export function buildSkillSection(skills, options = {}) {
  if (!skills || skills.length === 0) return "";

  const providerSlug = normalize(options.provider);

  if (providerSlug === "anthropic") {
    return buildReferenceSection(skills);
  }

  return buildInlineSection(skills);
}

function buildInlineSection(skills) {
  const header = [
    "## Domain Skills",
    "",
    "The following domain-specific knowledge is available for this task:"
  ].join("\n");

  const blocks = skills.map(
    (s) => `### ${s.name}\n${s.content}`
  );

  return [header, ...blocks].join("\n\n");
}

function buildReferenceSection(skills) {
  const names = skills.map((s) => s.name).join(", ");
  return [
    "## Domain Skills",
    "",
    `Skills available natively via your Agent Skills capability: ${names}.`,
    "Each skill's SKILL.md is already loaded in your runtime; invoke its guidance as needed without re-reading the full content."
  ].join("\n");
}

function normalize(value) {
  if (!value) return null;
  const lc = String(value).toLowerCase();
  if (lc === "claude" || lc === "anthropic") return "anthropic";
  if (lc === "codex" || lc === "openai") return "openai";
  if (lc === "gemini" || lc === "google") return "google";
  if (lc === "opencode") return "opencode";
  return lc;
}

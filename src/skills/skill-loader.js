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
 * When `role` is supplied, skills are filtered to those relevant to the role
 * (e.g. a reviewer only sees `*-code-review`, `*-security-*`, and general
 * patterns; see ROLE_SKILL_PATTERNS). Setting role to null/undefined keeps
 * the legacy behavior of injecting every skill (useful for the coder role,
 * which benefits from broad context).
 *
 * @param {Array<{name: string, content: string}>} skills
 * @param {{ provider?: string, role?: string }} [options]
 * @returns {string} prompt section or empty string
 */
export function buildSkillSection(skills, options = {}) {
  if (!skills || skills.length === 0) return "";

  const filtered = options.role ? filterSkillsForRole(skills, options.role) : skills;
  if (filtered.length === 0) return "";

  const providerSlug = normalize(options.provider);

  if (providerSlug === "anthropic") {
    return buildReferenceSection(filtered);
  }

  return buildInlineSection(filtered);
}

/**
 * Role → substring patterns that skills must match to be included. A skill
 * matches the role if its name contains ANY of the role's patterns OR if it
 * appears in the role's explicit allowlist. Coder is omitted on purpose: it
 * receives everything.
 *
 * The patterns target the skill NAMING convention shipped by openskills.cc
 * where skills are typically named like `react-patterns`, `java-code-review`,
 * `pytest-patterns`, `owasp-top-10`, etc.
 */
/**
 * Role → filter config.
 *
 * Two modes:
 *   - `includes` present: skill name must contain ANY include AND NOT contain
 *     any exclude. `allow` bypasses both checks (explicit allowlist by name).
 *   - `includes` absent (or empty) + `excludes` present: skill passes unless
 *     its name contains an exclude pattern. This is the "accept broad, trim
 *     obvious mismatches" mode used by architect.
 */
const ROLE_SKILL_PATTERNS = {
  reviewer: {
    includes: ["code-review", "security", "lint", "style", "antipatterns", "owasp"],
    excludes: [],
    allow: ["sql-analysis"],
  },
  architect: {
    // Architect sees everything except test-framework patterns. Architecture
    // decisions touch every domain, so keep the filter permissive.
    includes: null,
    excludes: ["pytest", "vitest", "jest", "playwright", "cypress"],
    allow: [],
  },
  tester: {
    includes: ["test", "pytest", "vitest", "jest", "playwright", "cypress"],
    excludes: [],
    allow: [],
  },
  security: {
    includes: ["security", "owasp", "sast"],
    excludes: [],
    allow: [],
  },
  planner: {
    // Planner gets broad stack context except test frameworks.
    includes: null,
    excludes: ["pytest", "vitest", "jest", "playwright", "cypress"],
    allow: [],
  },
  solomon: {
    includes: ["security", "code-review"],
    excludes: [],
    allow: [],
  },
};

/**
 * Filter skills for a given role using the ROLE_SKILL_PATTERNS map. Unknown
 * roles get ALL skills (conservative default for the coder role and any
 * future addition). Matching is case-insensitive substring.
 *
 * @param {Array<{name: string}>} skills
 * @param {string} role
 * @returns {Array} filtered array
 */
export function filterSkillsForRole(skills, role) {
  const cfg = ROLE_SKILL_PATTERNS[role];
  if (!cfg) return skills; // unknown role (e.g. coder) → no filter
  const includes = Array.isArray(cfg.includes) ? cfg.includes.map((s) => s.toLowerCase()) : null;
  const excludes = (cfg.excludes || []).map((s) => s.toLowerCase());
  const allow = new Set((cfg.allow || []).map((s) => s.toLowerCase()));
  return skills.filter((s) => {
    const name = (s.name || "").toLowerCase();
    if (allow.has(name)) return true;
    if (excludes.some((pat) => name.includes(pat))) return false;
    if (!includes || includes.length === 0) return true; // exclude-only mode
    return includes.some((pat) => name.includes(pat));
  });
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

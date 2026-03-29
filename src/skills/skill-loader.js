import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SKILL_DIRS = [".agent/skills", ".claude/skills"];
const SKILL_FILE = "SKILL.md";

/**
 * Scans known skill directories for SKILL.md files.
 * @param {string} projectDir — absolute path to the project root
 * @returns {Promise<Array<{name: string, content: string}>>}
 */
export async function loadAvailableSkills(projectDir) {
  const skills = [];

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
        const content = await readFile(skillPath, "utf-8");
        skills.push({ name: entry.name, content });
      } catch {
        // no SKILL.md in this subdirectory — skip
      }
    }
  }

  return skills;
}

/**
 * Builds a prompt section from loaded skills.
 * @param {Array<{name: string, content: string}>} skills
 * @returns {string} prompt section or empty string
 */
export function buildSkillSection(skills) {
  if (!skills || skills.length === 0) return "";

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

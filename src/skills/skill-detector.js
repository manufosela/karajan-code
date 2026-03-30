/**
 * Detects needed skills from task description and project files,
 * then auto-installs them via OpenSkills if available.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadAvailableSkills } from "./skill-loader.js";
import { isOpenSkillsAvailable, installSkill, removeSkill } from "./openskills-client.js";

/**
 * Known frameworks detectable from package.json dependencies.
 * Maps dependency name to the skill name to search for.
 */
const PKG_JSON_FRAMEWORKS = {
  astro: "astro",
  next: "nextjs",
  react: "react",
  "react-dom": "react",
  vue: "vue",
  svelte: "svelte",
  "@angular/core": "angular",
  express: "express",
  fastify: "fastify",
  "@nestjs/core": "nestjs",
};

/**
 * Language markers: file presence maps to a skill name.
 * Reuses the same concept as src/utils/project-detect.js LANGUAGE_MARKERS.
 */
const LANGUAGE_FILE_MARKERS = [
  { file: "pom.xml", skill: "java" },
  { file: "build.gradle", skill: "java" },
  { file: "build.gradle.kts", skill: "kotlin" },
  { file: "go.mod", skill: "go" },
  { file: "Cargo.toml", skill: "rust" },
  { file: "pyproject.toml", skill: "python" },
  { file: "setup.py", skill: "python" },
  { file: "Gemfile", skill: "ruby" },
  { file: "pubspec.yaml", skill: "flutter" },
  { file: "Package.swift", skill: "swift" },
  { file: "phpunit.xml", skill: "php" },
  { file: "composer.json", skill: "php" },
];

/**
 * Patterns to detect framework/skill mentions in the task text.
 * Each entry: regex pattern (case-insensitive) -> skill name.
 */
const TASK_TEXT_PATTERNS = [
  { pattern: /\bastro\b/i, skill: "astro" },
  { pattern: /\bnext\.?js\b/i, skill: "nextjs" },
  { pattern: /\breact\b/i, skill: "react" },
  { pattern: /\bvue\b/i, skill: "vue" },
  { pattern: /\bsvelte\b/i, skill: "svelte" },
  { pattern: /\bangular\b/i, skill: "angular" },
  { pattern: /\bexpress\b/i, skill: "express" },
  { pattern: /\bfastify\b/i, skill: "fastify" },
  { pattern: /\bnest\.?js\b/i, skill: "nestjs" },
  { pattern: /\bjava\b/i, skill: "java" },
  { pattern: /\bkotlin\b/i, skill: "kotlin" },
  { pattern: /\bgo(?:lang)?\b/i, skill: "go" },
  { pattern: /\brust\b/i, skill: "rust" },
  { pattern: /\bpython\b/i, skill: "python" },
  { pattern: /\bruby\b/i, skill: "ruby" },
  { pattern: /\bflutter\b/i, skill: "flutter" },
  { pattern: /\bswift\b/i, skill: "swift" },
  { pattern: /\bphp\b/i, skill: "php" },
];

/**
 * Analyze the task and project to determine what skills might be needed.
 * @param {string} task - The task description text.
 * @param {string} projectDir - Absolute path to project root.
 * @returns {Promise<string[]>} Array of unique skill names to search for.
 */
export async function detectNeededSkills(task, projectDir) {
  const needed = new Set();

  // 1. Scan package.json for known frameworks
  if (projectDir) {
    try {
      const pkgRaw = await fs.readFile(path.join(projectDir, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, skill] of Object.entries(PKG_JSON_FRAMEWORKS)) {
        if (allDeps[dep]) {
          needed.add(skill);
        }
      }
    } catch { /* no package.json or parse error — skip */ }

    // 2. Check for language markers
    for (const marker of LANGUAGE_FILE_MARKERS) {
      try {
        await fs.access(path.join(projectDir, marker.file));
        needed.add(marker.skill);
      } catch { /* file not found — skip */ }
    }
  }

  // 3. Check task text for framework mentions
  if (task) {
    for (const { pattern, skill } of TASK_TEXT_PATTERNS) {
      if (pattern.test(task)) {
        needed.add(skill);
      }
    }
  }

  return Array.from(needed);
}

/**
 * Auto-install needed skills that are not yet installed.
 * @param {string[]} neededSkills - Skill names to ensure are installed.
 * @param {string} projectDir - Absolute path to project root.
 * @returns {Promise<{installed: string[], failed: string[], alreadyInstalled: string[]}>}
 */
export async function autoInstallSkills(neededSkills, projectDir) {
  const result = { installed: [], failed: [], alreadyInstalled: [] };

  if (!neededSkills || neededSkills.length === 0) {
    return result;
  }

  // Check which skills are already installed locally
  const existingSkills = await loadAvailableSkills(projectDir);
  const existingNames = new Set(existingSkills.map(s => s.name.toLowerCase()));

  // Check if OpenSkills is available
  const osAvailable = await isOpenSkillsAvailable();
  if (!osAvailable) {
    // All skills count as "failed" silently — caller should check osAvailable separately
    return result;
  }

  for (const skillName of neededSkills) {
    if (existingNames.has(skillName.toLowerCase())) {
      result.alreadyInstalled.push(skillName);
      continue;
    }

    try {
      const installResult = await installSkill(skillName, { projectDir });
      if (installResult.ok) {
        result.installed.push(installResult.name || skillName);
      } else {
        result.failed.push(skillName);
      }
    } catch { /* skill install threw */
      result.failed.push(skillName);
    }
  }

  return result;
}

/**
 * Remove skills that were auto-installed during this session.
 * @param {string[]} skillNames - Skill names to remove.
 * @param {string} projectDir - Absolute path to project root.
 * @returns {Promise<{removed: string[], failed: string[]}>}
 */
export async function cleanupAutoInstalledSkills(skillNames, projectDir) {
  const result = { removed: [], failed: [] };

  if (!skillNames || skillNames.length === 0) {
    return result;
  }

  for (const name of skillNames) {
    try {
      const removeResult = await removeSkill(name, { projectDir });
      if (removeResult.ok) {
        result.removed.push(name);
      } else {
        result.failed.push(name);
      }
    } catch { /* skill removal threw */
      result.failed.push(name);
    }
  }

  return result;
}

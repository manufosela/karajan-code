/**
 * Detects needed skills from task description and project files,
 * then auto-installs them via OpenSkills if available.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadAvailableSkills } from "./skill-loader.js";
import { isOpenSkillsAvailable, installSkill, removeSkill } from "./openskills-client.js";
import { isFresh as isCacheFresh, recordInstall as recordSkillInstall } from "./skills-cache.js";

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
  // DB / ORM
  prisma: "prisma",
  "@prisma/client": "prisma",
  knex: "sql-analysis",
  sequelize: "sql-analysis",
  typeorm: "sql-analysis",
  mongoose: "mongodb",
  "better-sqlite3": "sql-analysis",
  // Testing
  vitest: "vitest-patterns",
  jest: "jest-patterns",
  "@playwright/test": "playwright-patterns",
  cypress: "cypress-patterns",
};

/**
 * Python dependency names (from requirements.txt or pyproject.toml) mapping
 * to their canonical skill.
 */
const PYTHON_DEPS = {
  pandas: "python-data",
  numpy: "python-data",
  scipy: "python-data",
  "scikit-learn": "python-ml",
  sklearn: "python-ml",
  tensorflow: "python-ml",
  torch: "python-ml",
  pytorch: "python-ml",
  pytest: "pytest-patterns",
  django: "python-django",
  flask: "python-flask",
  fastapi: "python-fastapi",
  sqlalchemy: "sql-analysis",
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
  { file: "requirements.txt", skill: "python" },
  { file: "setup.py", skill: "python" },
  { file: "Gemfile", skill: "ruby" },
  { file: "pubspec.yaml", skill: "flutter" },
  { file: "Package.swift", skill: "swift" },
  { file: "phpunit.xml", skill: "php" },
  { file: "composer.json", skill: "php" },
  { file: "mix.exs", skill: "elixir" },
  { file: "rebar.config", skill: "erlang" },
];

/**
 * File EXTENSIONS whose presence anywhere under projectDir adds a skill.
 * Uses a shallow-recursive glob with a cutoff to avoid walking node_modules.
 */
const EXTENSION_MARKERS = [
  { ext: ".csproj", skill: "dotnet" },
  { ext: ".sln", skill: "dotnet" },
  { ext: ".ipynb", skill: "python-data" },
  { ext: ".prisma", skill: "prisma" },
];

/**
 * Files detected as "SQL / database schema" when they exist at repo root.
 * Used in addition to EXTENSION_MARKERS for *.sql anywhere in the repo.
 */
const SQL_MARKER_FILES = [
  "schema.sql",
  "schema.prisma",
  "migrations",
  "db/migrate",
];

const DIRECTORIES_TO_SKIP = new Set([
  "node_modules", ".git", ".kj", ".karajan", "dist", "build", ".next", "out",
  "target", ".venv", "venv", "__pycache__", ".vitest-cache", "coverage",
]);

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
  { pattern: /\bdjango\b/i, skill: "python" },
  { pattern: /\bflask\b/i, skill: "python" },
  { pattern: /\bruby\b/i, skill: "ruby" },
  { pattern: /\bflutter\b/i, skill: "flutter" },
  { pattern: /\bswift\b/i, skill: "swift" },
  { pattern: /\bphp\b/i, skill: "php" },
  { pattern: /\bSQL\b/i, skill: "sql-analysis" },
  { pattern: /\bquer(?:y|ies)\b/i, skill: "sql-analysis" },
  { pattern: /\bdatabase\b/i, skill: "sql-analysis" },
  { pattern: /\bCSV\b/i, skill: "csv-transform" },
  { pattern: /\btransform\b/i, skill: "csv-transform" },
  { pattern: /\bparse\b/i, skill: "csv-transform" },
  { pattern: /\breport\b/i, skill: "data-report" },
  { pattern: /\banalysis\b/i, skill: "data-report" },
  { pattern: /\bfindings\b/i, skill: "data-report" },
  // Frontend/backend broad categories
  { pattern: /\bfrontend\b/i, skill: "frontend-design" },
  { pattern: /\bCSS\b/i, skill: "frontend-design" },
  { pattern: /\bHTML\b/i, skill: "frontend-design" },
  { pattern: /\bbackend\b/i, skill: "express" },
  { pattern: /\bnode\.?js\b/i, skill: "express" },
  { pattern: /\bAPI\b/, skill: "express" },
  { pattern: /\bwebsocket\b/i, skill: "express" },
  { pattern: /\breal[- ]time\b/i, skill: "express" },
];

/**
 * Analyze the task and project to determine what skills might be needed.
 *
 * @param {string} task - The task description text.
 * @param {string} projectDir - Absolute path to project root.
 * @param {{ includeExtensions?: boolean, maxDepth?: number }} [options]
 *   - includeExtensions: scan for file extensions (.csproj, .ipynb, .sql...)
 *     that signal a stack. Default true. Disable to avoid the shallow walk
 *     in very large repos or in tests.
 *   - maxDepth: bound the walk (default 3 directories deep).
 * @returns {Promise<string[]>} Array of unique skill names to search for.
 */
export async function detectNeededSkills(task, projectDir, options = {}) {
  const { includeExtensions = true, maxDepth = 3 } = options;
  const needed = new Set();

  // 1. Scan package.json for known frameworks and JS-ecosystem deps
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

    // 2. Language marker files at repo root
    for (const marker of LANGUAGE_FILE_MARKERS) {
      try {
        await fs.access(path.join(projectDir, marker.file));
        needed.add(marker.skill);
      } catch { /* file not found — skip */ }
    }

    // 3. Python deps from requirements.txt / pyproject.toml
    await collectPythonDeps(projectDir, needed);

    // 4. File extension markers (.csproj, .ipynb, .prisma, *.sql)
    if (includeExtensions) {
      await collectExtensionMarkers(projectDir, maxDepth, needed);
    }

    // 5. SQL / DB schema markers at well-known paths
    for (const candidate of SQL_MARKER_FILES) {
      try {
        await fs.access(path.join(projectDir, candidate));
        needed.add("sql-analysis");
      } catch { /* skip */ }
    }
  }

  // 6. Task text patterns
  if (task) {
    for (const { pattern, skill } of TASK_TEXT_PATTERNS) {
      if (pattern.test(task)) {
        needed.add(skill);
      }
    }
  }

  return Array.from(needed);
}

async function collectPythonDeps(projectDir, needed) {
  // requirements.txt — each non-comment line is "name==ver" or "name>=ver"
  try {
    const raw = await fs.readFile(path.join(projectDir, "requirements.txt"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim().split("#")[0].trim();
      if (!trimmed) continue;
      const name = trimmed.split(/[<>=!~[\s]/)[0].toLowerCase();
      const skill = PYTHON_DEPS[name];
      if (skill) needed.add(skill);
    }
  } catch { /* no requirements.txt */ }

  // pyproject.toml — simple heuristic scan for dependency names. A full TOML
  // parse would need a dep; we just look for quoted names, which is fine.
  try {
    const raw = await fs.readFile(path.join(projectDir, "pyproject.toml"), "utf8");
    const lower = raw.toLowerCase();
    for (const [name, skill] of Object.entries(PYTHON_DEPS)) {
      if (lower.includes(`"${name}"`) || lower.includes(`'${name}'`)) {
        needed.add(skill);
      }
    }
  } catch { /* no pyproject.toml */ }
}

async function collectExtensionMarkers(projectDir, maxDepth, needed) {
  // Build a lookup by extension for fast decisions.
  const byExt = new Map(EXTENSION_MARKERS.map((m) => [m.ext, m.skill]));
  const extensions = new Set(byExt.keys());
  extensions.add(".sql");
  let sqlFound = false;

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DIRECTORIES_TO_SKIP.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        await walk(path.join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.has(ext)) continue;
      if (ext === ".sql") {
        sqlFound = true;
        continue;
      }
      const skill = byExt.get(ext);
      if (skill) needed.add(skill);
    }
  }

  await walk(projectDir, 0);
  if (sqlFound) needed.add("sql-analysis");
}

/**
 * Auto-install needed skills that are not yet installed.
 *
 * When the `openskills` CLI is not available, this function degrades
 * gracefully: it returns `osAvailable: false` and `wouldHaveUsed` with the
 * list of skills that would have been installed if the CLI had been present.
 * Callers (e.g. the orchestrator) can surface this info in the session
 * report without blocking execution.
 *
 * @param {string[]} neededSkills - Skill names to ensure are installed.
 * @param {string} projectDir - Absolute path to project root.
 * @returns {Promise<{
 *   installed: string[],
 *   failed: string[],
 *   alreadyInstalled: string[],
 *   wouldHaveUsed: string[],
 *   osAvailable: boolean
 * }>}
 */
export async function autoInstallSkills(neededSkills, projectDir) {
  const result = { installed: [], failed: [], alreadyInstalled: [], wouldHaveUsed: [], osAvailable: true };

  if (!neededSkills || neededSkills.length === 0) {
    return result;
  }

  // Check which skills are already installed locally
  const existingSkills = await loadAvailableSkills(projectDir);
  const existingNames = new Set(existingSkills.map(s => s.name.toLowerCase()));

  // Check if OpenSkills is available
  const osAvailable = await isOpenSkillsAvailable();
  if (!osAvailable) {
    result.osAvailable = false;
    // Report what we would have installed so the session report can surface
    // the recommendation — "install openskills globally to enable: X, Y, Z".
    result.wouldHaveUsed = neededSkills.filter((s) => !existingNames.has(s.toLowerCase()));
    return result;
  }

  for (const skillName of neededSkills) {
    if (existingNames.has(skillName.toLowerCase())) {
      result.alreadyInstalled.push(skillName);
      continue;
    }

    // Cache short-circuit: if we installed this skill in the last 7 days,
    // assume it's still good and skip the `npx openskills install` call
    // (which can take 10-30s). Running sessions can opt out by clearing
    // the cache with `kj skills clear-cache`.
    if (await isCacheFresh(skillName)) {
      result.alreadyInstalled.push(skillName);
      continue;
    }

    try {
      const installResult = await installSkill(skillName, { projectDir });
      if (installResult.ok) {
        const installedName = installResult.name || skillName;
        result.installed.push(installedName);
        await recordSkillInstall(installedName, { source: skillName }).catch(() => {});
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

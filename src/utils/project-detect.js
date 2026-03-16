import fs from "node:fs/promises";
import path from "node:path";

const TEST_FRAMEWORKS = ["vitest", "jest", "@jest/core", "mocha", "ava", "tap", "playwright", "@playwright/test"];

const CONFIG_FILES = [
  "vitest.config.js", "vitest.config.ts",
  "jest.config.js", "jest.config.ts", "jest.config.mjs",
  ".mocharc.yml", ".mocharc.json",
  "playwright.config.js", "playwright.config.ts"
];

function frameworkFromConfig(filename) {
  if (filename.startsWith("vitest")) return "vitest";
  if (filename.startsWith("jest")) return "jest";
  if (filename.startsWith(".mocha")) return "mocha";
  return "playwright";
}

/**
 * Detect if the project has a test framework configured.
 * Checks: package.json devDependencies/dependencies for known test frameworks.
 * Also checks for config files (vitest.config, jest.config, .mocharc, playwright.config).
 * @param {string} cwd - Project root
 * @returns {Promise<{hasTests: boolean, framework: string|null}>}
 */
export async function detectTestFramework(cwd = process.cwd()) {
  try {
    const pkgRaw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const fw of TEST_FRAMEWORKS) {
      if (allDeps[fw]) {
        return { hasTests: true, framework: fw };
      }
    }
  } catch { /* no package.json or parse error */ }

  for (const cf of CONFIG_FILES) {
    try {
      await fs.access(path.join(cwd, cf));
      return { hasTests: true, framework: frameworkFromConfig(cf) };
    } catch { /* not found */ }
  }

  return { hasTests: false, framework: null };
}

/**
 * Detect if SonarQube is configured for this project.
 * @param {string} cwd - Project root
 * @returns {Promise<{configured: boolean}>}
 */
export async function detectSonarConfig(cwd = process.cwd()) {
  try {
    await fs.access(path.join(cwd, "sonar-project.properties"));
    return { configured: true };
  } catch {
    return { configured: false };
  }
}

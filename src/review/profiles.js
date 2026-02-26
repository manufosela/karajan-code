/**
 * Review profile resolver.
 * Loads mode-specific reviewer instructions with fallback chain:
 *   1. Project-level / user-level / built-in reviewer-{mode}.md
 *   2. Project-level / user-level / built-in reviewer.md
 *   3. Hardcoded default
 */

import path from "node:path";
import { loadFirstExisting } from "../roles/base-role.js";
import { getKarajanHome } from "../utils/paths.js";

const KNOWN_MODES = ["paranoid", "strict", "standard", "relaxed"];

const DEFAULT_RULES = "Focus on critical issues: security vulnerabilities, logic errors, and broken tests.";

function buildCandidates(fileName, projectDir) {
  const candidates = [];

  if (projectDir) {
    candidates.push(path.join(projectDir, ".karajan", "roles", fileName));
  }

  candidates.push(path.join(getKarajanHome(), "roles", fileName));

  const builtIn = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "templates",
    "roles",
    fileName
  );
  candidates.push(builtIn);

  return candidates;
}

export async function resolveReviewProfile({ mode = "standard", projectDir } = {}) {
  // Known modes: try mode-specific file first, then base reviewer.md
  if (KNOWN_MODES.includes(mode)) {
    const modePaths = buildCandidates(`reviewer-${mode}.md`, projectDir);
    const modeRules = await loadFirstExisting(modePaths);
    if (modeRules) {
      return { mode, rules: modeRules };
    }

    // Fallback to base reviewer.md
    const basePaths = buildCandidates("reviewer.md", projectDir);
    const baseRules = await loadFirstExisting(basePaths);
    if (baseRules) {
      return { mode, rules: baseRules };
    }

    return { mode, rules: DEFAULT_RULES };
  }

  // Custom/unknown modes: only check base reviewer.md
  const basePaths = buildCandidates("reviewer.md", projectDir);
  const baseRules = await loadFirstExisting(basePaths);
  if (baseRules) {
    return { mode, rules: baseRules };
  }

  return { mode, rules: DEFAULT_RULES };
}

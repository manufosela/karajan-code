/**
 * HU-4999 (#4811): the .karajan/coder-rules.md kj init writes follows the
 * project's stack and base branch.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { baseBranchFrom } from "../config/base-branch.js";
import { exists } from "../utils/fs.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { getTemplatesRoot } from "../utils/templates-root.js";

const JS_LANGUAGES = new Set(["javascript", "typescript"]);

const FALLBACK = [
  "# Coder Rules",
  "",
  "## File modification safety",
  "",
  "- NEVER overwrite existing files entirely. Always make targeted, minimal edits.",
  "- After each edit, verify with `git diff` that ONLY the intended lines changed.",
  "- Do not modify code unrelated to the task.",
  ""
].join("\n");

/** Keeps `{{#js}}` blocks for JS/TS and `{{^js}}` blocks for the rest, then names the base branch. */
function renderCoderRules(template, { base, isJs }) {
  return template
    .replaceAll(/\{\{([#^])js\}\}\n([\s\S]*?)\{\{\/js\}\}\n/g, (_, kind, body) => ((kind === "#") === isJs ? body : ""))
    .replaceAll("{{base}}", () => base);
}

async function readTemplate() {
  try {
    return await fs.readFile(path.join(getTemplatesRoot(), "coder-rules.md"), "utf8");
  } catch { /* template not found, use inline default */
    return FALLBACK;
  }
}

export async function ensureCoderRules(coderRulesPath, { config, projectDir, logger }) {
  if (await exists(coderRulesPath)) return;
  const { language } = await detectProjectStack(projectDir);
  const content = renderCoderRules(await readTemplate(), {
    base: baseBranchFrom({ config, projectDir, logger, announce: false, label: "kj init" }),
    isJs: JS_LANGUAGES.has(language)
  });
  await fs.writeFile(coderRulesPath, content, "utf8");
  logger.info("Created .karajan/coder-rules.md");
}

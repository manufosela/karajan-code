/**
 * Gemini CLI reads GEMINI.md unless the project's settings name another file
 * (KJC-TSK-1504). kj keeps its rules in AGENTS.md alone, so it adds AGENTS.md
 * to `context.fileName` in .gemini/settings.json, leaving every other setting
 * as it was. Settings it cannot parse are left alone and reported.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const GEMINI_SETTINGS = ".gemini/settings.json";
const RULES_FILE = "AGENTS.md";

const asList = (value) => {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
};

/** The settings object, or null when the file is not a JSON object. */
function readSettings(target) {
  try {
    const value = JSON.parse(readFileSync(target, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function installGeminiContext({ projectDir, dryRun = false }) {
  const target = join(projectDir, GEMINI_SETTINGS);
  const exists = existsSync(target);
  const settings = exists ? readSettings(target) : {};
  if (!settings) {
    return { file: GEMINI_SETTINGS, action: "skipped", note: `not valid JSON or not an object: add "${RULES_FILE}" to context.fileName by hand` };
  }
  const names = asList(settings.context?.fileName);
  if (names.includes(RULES_FILE)) return { file: GEMINI_SETTINGS, action: "unchanged" };
  const next = { ...settings, context: { ...settings.context, fileName: [...names, RULES_FILE] } };
  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { file: GEMINI_SETTINGS, action: exists ? "updated" : "inserted" };
}

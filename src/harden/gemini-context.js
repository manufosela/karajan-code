/**
 * Gemini CLI reads GEMINI.md unless the project's settings name another file
 * (KJC-TSK-1504). kj keeps its rules in AGENTS.md alone, so it adds AGENTS.md
 * to `context.fileName` in .gemini/settings.json, leaving every other setting
 * as it was. Settings it cannot parse are left alone and reported.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const GEMINI_SETTINGS = ".gemini/settings.json";
const RULES_FILE = "AGENTS.md";

const asList = (value) => {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
};

/** The project's own Prettier CLI script (from its package.json bin), or null without one. */
function projectPrettier(projectDir) {
  const pkgDir = join(projectDir, "node_modules", "prettier");
  try {
    const { bin } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const script = typeof bin === "string" ? bin : bin?.prettier;
    return script ? join(pkgDir, script) : null;
  } catch {
    return null;
  }
}

/**
 * The text in the layout the project's own Prettier gives it, with its config (width, tabs,
 * line endings), so a pre-commit that checks the format accepts the file kj writes. Without a
 * Prettier no check can reject the layout and the text stays as it is; a Prettier that fails
 * is reported in `note`.
 */
function formatForProject(projectDir, text) {
  const script = projectPrettier(projectDir);
  if (!script) return { text };
  const r = spawnSync(process.execPath, [script, "--stdin-filepath", GEMINI_SETTINGS], { cwd: projectDir, input: text, encoding: "utf8" });
  if (r.status === 0 && r.stdout) return { text: r.stdout };
  return { text, note: `the project's Prettier could not format it (${(r.stderr || r.error?.message || "").trim().split("\n")[0]}): run it on ${GEMINI_SETTINGS}` };
}

/** The settings object, or null when the file is not a JSON object. */
function readSettings(target) {
  try {
    const value = JSON.parse(readFileSync(target, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Whether the project's Gemini CLI settings name AGENTS.md (what kj doctor checks). */
export function geminiReadsAgentsFile(projectDir) {
  const target = join(projectDir, GEMINI_SETTINGS);
  const settings = existsSync(target) ? readSettings(target) : null;
  return asList(settings?.context?.fileName).includes(RULES_FILE);
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
  const action = exists ? "updated" : "inserted";
  if (dryRun) return { file: GEMINI_SETTINGS, action };
  const { text, note } = formatForProject(projectDir, `${JSON.stringify(next, null, 2)}\n`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return { file: GEMINI_SETTINGS, action, ...(note ? { note } : {}) };
}

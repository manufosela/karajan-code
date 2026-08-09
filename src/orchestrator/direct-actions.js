// Direct actions: commands Karajan Brain can execute without invoking a full role.
// Keeps the action catalog small, auditable, and safe.

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {Object} DirectAction
 * @property {string} type - action type identifier
 * @property {Object} params - action-specific parameters
 */

/**
 * @typedef {Object} ActionResult
 * @property {boolean} ok
 * @property {string} [output]
 * @property {string} [error]
 * @property {string} action
 */

const ALLOWED_COMMANDS = [
  "npm install", "npm ci", "pnpm install", "yarn install",
  "pip install -r requirements.txt", "poetry install",
  "go mod download", "cargo fetch",
  "bundle install", "composer install", "dotnet restore"
];

// KJC-BUG-0099: a dependency install must not be arbitrary code execution —
// lifecycle hooks (postinstall & friends) run whatever the dependency ships.
// The allow-list above names the INTENT; execution appends the ecosystem's
// script-skipping flag. Ecosystems without package hooks run untouched.
const HARDEN_FLAGS = {
  npm: ["--ignore-scripts"],
  pnpm: ["--ignore-scripts"],
  yarn: ["--ignore-scripts"],
  composer: ["--no-scripts", "--no-plugins"],
};

/**
 * True when `target` resolves to a path inside `base` (or is `base` itself).
 * Uses path.relative instead of a string prefix check: a naive
 * `resolved.startsWith(base)` lets a sibling with a shared prefix slip through
 * (base `/repo/app` would accept `/repo/app2`). Also rejects absolute paths
 * pointing outside the project.
 */
function isInsideBase(target, base) {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Validate that a shell command is in the allow-list.
 * Prevents arbitrary command execution.
 */
function isCommandAllowed(cmd) {
  if (!cmd || typeof cmd !== "string") return false;
  const tokens = cmd.trim().split(/\s+/);
  return ALLOWED_COMMANDS.some(allowed => {
    const allowedTokens = allowed.split(/\s+/);
    return allowedTokens.every((t, i) => tokens[i] === t) && tokens.length === allowedTokens.length;
  });
}

/**
 * Execute an allowed shell command (install deps, etc.).
 */
async function runCommand({ cmd, cwd }) {
  if (!isCommandAllowed(cmd)) {
    return { ok: false, error: `Command not in allow-list: ${cmd}`, action: "run_command" };
  }

  try {
    // Audit follow-up: was using execSync, which routes through /bin/sh.
    // Even though `cmd` is allow-listed, defense-in-depth: switched to
    // execFileSync with a tokenised arg array so no shell expansion at all.
    const [program, ...args] = cmd.trim().split(/\s+/);
    const output = execFileSync(program, [...args, ...(HARDEN_FLAGS[program] ?? [])], {
      cwd: cwd || process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000
    });
    return { ok: true, output: output.trim(), action: "run_command" };
  } catch (err) {
    return { ok: false, error: err.message, action: "run_command" };
  }
}

/**
 * Create a file with given content (only if it doesn't exist).
 */
async function createFile({ filePath, content, cwd, overwrite = false }) {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd || process.cwd(), filePath);

    // Path traversal guard
    const resolved = path.resolve(fullPath);
    const base = path.resolve(cwd || process.cwd());
    if (!isInsideBase(resolved, base)) {
      return { ok: false, error: "Path traversal denied", action: "create_file" };
    }

    try {
      await fs.access(fullPath);
      if (!overwrite) {
        return { ok: false, error: `File already exists: ${filePath}`, action: "create_file" };
      }
    } catch { /* file doesn't exist, proceed */ }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content || "", "utf8");
    return { ok: true, output: `Created ${filePath}`, action: "create_file" };
  } catch (err) {
    return { ok: false, error: err.message, action: "create_file" };
  }
}

/**
 * Append entries to .gitignore (creates if missing, skips duplicates).
 */
async function updateGitignore({ entries, cwd }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, error: "No entries provided", action: "update_gitignore" };
  }

  try {
    const gitignorePath = path.join(cwd || process.cwd(), ".gitignore");
    let content = "";
    try {
      content = await fs.readFile(gitignorePath, "utf8");
    } catch { /* will create */ }

    const missing = entries.filter(e => !content.includes(e));
    if (missing.length === 0) {
      return { ok: true, output: "All entries already present", action: "update_gitignore" };
    }

    const append = (content && !content.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n";
    await fs.appendFile(gitignorePath, append, "utf8");
    return { ok: true, output: `Added: ${missing.join(", ")}`, action: "update_gitignore" };
  } catch (err) {
    return { ok: false, error: err.message, action: "update_gitignore" };
  }
}

/**
 * Stage files with git add.
 */
async function gitAdd({ files, cwd }) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: "No files to add", action: "git_add" };
  }

  try {
    // Reject shell metacharacters and anything that resolves outside the project.
    const base = path.resolve(cwd || process.cwd());
    for (const f of files) {
      if (typeof f !== "string" || /[;&|`$]/.test(f) || !isInsideBase(path.resolve(base, f), base)) {
        return { ok: false, error: `Invalid file path: ${f}`, action: "git_add" };
      }
    }
    execFileSync("git", ["add", ...files], {
      cwd: cwd || process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { ok: true, output: `Staged ${files.length} file(s)`, action: "git_add" };
  } catch (err) {
    return { ok: false, error: err.message, action: "git_add" };
  }
}

const ACTION_HANDLERS = {
  run_command: runCommand,
  create_file: createFile,
  update_gitignore: updateGitignore,
  git_add: gitAdd
};

/**
 * Execute a single direct action.
 */
export async function executeAction(action, { cwd } = {}) {
  if (!action || typeof action !== "object") {
    return { ok: false, error: "Invalid action", action: "unknown" };
  }

  const handler = ACTION_HANDLERS[action.type];
  if (!handler) {
    return { ok: false, error: `Unknown action type: ${action.type}`, action: action.type };
  }

  return handler({ ...action.params, cwd: cwd || action.params?.cwd });
}

/**
 * Execute a list of actions in sequence. Stops on first failure unless continueOnError.
 */
export async function executeActions(actions, { cwd, continueOnError = false } = {}) {
  const results = [];
  for (const action of actions || []) {
    const result = await executeAction(action, { cwd });
    results.push(result);
    if (!result.ok && !continueOnError) break;
  }
  return results;
}

/**
 * Get list of allowed action types.
 */
export function getAllowedActionTypes() {
  return Object.keys(ACTION_HANDLERS);
}

export { isCommandAllowed };

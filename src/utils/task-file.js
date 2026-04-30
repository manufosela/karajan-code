/**
 * Load a task description from a file (.md / .txt / .markdown / any plain text).
 *
 * Motivation: for anything beyond a one-line task, writing a `kj run "long
 * multi-paragraph prompt ..."` becomes painful — escaping quotes, losing
 * markdown formatting, no history. `kj run --task-file my-task.md` reads the
 * file's contents and uses them as the task description. Same for `kj plan`,
 * `kj audit`, `kj code`, and their MCP counterparts (via the `taskFile`
 * argument).
 *
 * Behaviour:
 *   - `taskFile` may be relative (resolved against `process.cwd()` by default,
 *     or against `projectDir` if supplied) or absolute.
 *   - Accepts any text file; markdown is the expected common case but we do
 *     not require a specific extension.
 *   - Trimmed of leading/trailing whitespace so agents don't get empty lines
 *     around the task.
 *   - `maxBytes` (default 256 KiB) guards against accidentally passing a huge
 *     file (log dumps, PDFs). Agents choke on very long prompts anyway.
 *   - Precedence with the positional `task` arg is decided by the caller:
 *     this helper only loads, never merges. Convention used across commands:
 *     when BOTH are provided, the positional task wins and the file is a
 *     fallback — with a log warning so the user notices.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_TASK_FILE_MAX_BYTES = 256 * 1024;

/**
 * @param {string} filePath                - relative or absolute
 * @param {Object} [opts]
 * @param {string} [opts.projectDir]       - base dir for relative paths; defaults to process.cwd()
 * @param {number} [opts.maxBytes]         - size cap; default 256 KiB
 * @returns {Promise<string>}              - the trimmed file contents (task text)
 * @throws                                 - Error with a user-readable message when the file is
 *                                           missing, unreadable, empty, or over the size cap.
 */
export async function readTaskFile(filePath, opts = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("readTaskFile: path must be a non-empty string");
  }
  const { projectDir, maxBytes = DEFAULT_TASK_FILE_MAX_BYTES } = opts;
  const base = projectDir || process.cwd();
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(base, filePath);

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    throw new Error(`Task file not found: ${resolved} (${err.code || err.message})`, { cause: err });
  }
  if (!stat.isFile()) {
    throw new Error(`Task file is not a regular file: ${resolved}`);
  }
  if (stat.size > maxBytes) {
    const kb = Math.round(stat.size / 1024);
    const capKb = Math.round(maxBytes / 1024);
    throw new Error(
      `Task file is too large: ${resolved} (${kb} KiB > ${capKb} KiB cap). ` +
      `Summarise the task or raise the limit with the caller's maxBytes option.`
    );
  }

  const raw = await fs.readFile(resolved, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Task file is empty (or whitespace-only): ${resolved}`);
  }
  return trimmed;
}

/**
 * Resolve the task text a command should use, given both positional `task`
 * and an optional `taskFile`. Single source of truth for precedence across
 * CLI and MCP entry points.
 *
 * Rules:
 *   - Neither provided → throw (caller decides the UX; typically propagates).
 *   - Only `task` → returns it, untouched.
 *   - Only `taskFile` → reads and returns it.
 *   - Both → `task` wins; emits a warning through `logger.warn` (if given).
 *
 * @param {Object} args
 * @param {string|undefined} args.task
 * @param {string|undefined} args.taskFile
 * @param {string} [args.projectDir]
 * @param {Object} [args.logger]             - optional; uses `logger.warn(msg)` only
 * @returns {Promise<string>}
 */
export async function resolveTaskInput({ task, taskFile, projectDir, logger } = {}) {
  const hasTask = typeof task === "string" && task.trim().length > 0;
  const hasFile = typeof taskFile === "string" && taskFile.trim().length > 0;

  if (!hasTask && !hasFile) {
    throw new Error("No task provided. Pass a task argument or --task-file <path>.");
  }
  if (hasTask && hasFile) {
    logger?.warn?.(
      `Both task and --task-file given; using the positional task and ignoring file: ${taskFile}`
    );
    return task.trim();
  }
  if (hasFile) {
    return readTaskFile(taskFile, { projectDir });
  }
  return task.trim();
}

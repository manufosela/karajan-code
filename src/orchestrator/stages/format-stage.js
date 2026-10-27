/**
 * KJC-TSK-1237 (#2565): no stage formatted the coder's files, so a pre-commit
 * format check aborted the final commit after every gate was green, and a
 * one-command fix reached Solomon. This stage runs the project's formatter in
 * write mode (the one kj harden knows) on the files of this session only:
 * pending now and not pending when the session started. It is not a gate: a
 * failing or missing formatter is said and the next stages judge the files.
 * Opt-out: `development.format_after_coder: false`.
 */
import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { runCommand } from "../../utils/process.js";
import { listPendingPaths } from "../../utils/git.js";
import { detectStackRoots } from "../../harden/stack-roots.js";
import { formatWriteFor } from "../../harden/hook-commands.js";

const TIMEOUT_MS = 2 * 60 * 1000;
const primaryLanguage = (projectDir) => detectStackRoots(projectDir)[0]?.language ?? null;

const expand = (projectDir, p) => (p.endsWith("/")
  ? readdirSync(join(projectDir, p), { recursive: true }).map((f) => join(p, f))
  : [p]);

/** Files of the session the formatter takes; git names a new directory, so its files are listed. */
function filesToFormat({ pending, preexisting, extensions, projectDir }) {
  const before = new Set(preexisting);
  return pending.filter((p) => !before.has(p) && existsSync(join(projectDir, p)))
    .flatMap((p) => expand(projectDir, p))
    .filter((p) => extensions.includes(extname(p)));
}

/** @returns {Promise<{ran: boolean, ok?: boolean, files?: string[]}>} */
export async function runFormatStage({ config, logger, emitter, eventBase, session, detectLanguageImpl = primaryLanguage, listPendingImpl = (dir) => listPendingPaths(dir), runImpl = async (...args) => runCommand(...args) }) {
  if (config?.development?.format_after_coder === false) return { ran: false };
  const projectDir = config?.projectDir || process.cwd();
  const formatter = formatWriteFor(detectLanguageImpl(projectDir), projectDir);
  if (!formatter) return { ran: false };
  const preexisting = session?.git_preexisting;
  if (!Array.isArray(preexisting)) {
    logger?.warn?.("format: no baseline of what was pending when the session started: nothing formatted");
    return { ran: false };
  }
  let files;
  try {
    files = filesToFormat({ pending: await listPendingImpl(projectDir), preexisting, extensions: formatter.extensions, projectDir });
  } catch (err) {
    logger?.warn?.(`format: the session's files could not be listed (${err.message}): nothing formatted`);
    return { ran: false };
  }
  if (files.length === 0) return { ran: false };
  const [bin, ...args] = formatter.command.split(" ");
  const res = await runImpl(bin, [...args, "--", ...files], { cwd: projectDir, timeout: TIMEOUT_MS }).catch(() => ({ exitCode: null }));
  const ok = res.exitCode === 0;
  const message = ok
    ? `format: ${formatter.command} on ${files.length} file(s)`
    : `format: ${formatter.command} failed (exit ${res.exitCode ?? "none"}); the next stages judge the files as they are`;
  logger?.[ok ? "info" : "warn"]?.(message);
  emitProgress(emitter, makeEvent("format:result", { ...eventBase, stage: "format" }, { status: ok ? "ok" : "warn", message, detail: { command: formatter.command, files } }));
  return { ran: true, ok, files };
}

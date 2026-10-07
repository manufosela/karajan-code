/**
 * KJC-BUG-0298 (#1993): with TDD, a red suite never reaches the reviewer. A
 * step whose test was added without its implementation was approved with one
 * failing file, because nothing in the iteration RAN the tests: the
 * verification gate counts changed lines, the TDD check asks that tests changed
 * alongside sources, and the red-then-green discipline is opt-in. This stage
 * runs the project's own test command (the one kj harden resolves: npm test, a
 * known framework, pytest, go test) and hands a red suite back to the coder.
 * Opt-out: `development.require_green_suite: false`.
 */
import { addCheckpoint, saveSession } from "../../session/store.js";
import { setReviewerFeedback } from "../../session/mutators.js";
import { emitProgress, makeEvent } from "../../utils/events.js";
import { runCommand } from "../../utils/process.js";
import { resolveCmds } from "../../commands/harden.js";

const TAIL_CHARS = 2000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** @returns {Promise<{action: "ok"|"continue", result: object}>} */
export async function runSuiteGreenStage({ config, logger, emitter, eventBase, session, iteration, resolveCmdsImpl = resolveCmds, runTestsImpl = null }) {
  const projectDir = config?.projectDir || process.cwd();
  let command = null;
  try {
    command = (await resolveCmdsImpl(projectDir))?.test || null;
  } catch (err) {
    logger?.warn?.(`suite-green: could not resolve the test command (${err.message})`);
  }
  if (!command) {
    const message = "suite-green: no test command for this project (package.json scripts.test or a known framework): the suite was NOT run";
    logger?.warn?.(message);
    emitProgress(emitter, makeEvent("tests:result", { ...eventBase, stage: "tests" }, { status: "warn", message, detail: { ran: false } }));
    return { action: "ok", result: { ran: false } };
  }
  const timeout = Number(config?.development?.test_timeout_ms) > 0 ? Number(config.development.test_timeout_ms) : DEFAULT_TIMEOUT_MS;
  const run = runTestsImpl || (async () => {
    const res = await runCommand("bash", ["-lc", command], { cwd: projectDir, timeout });
    return { exitCode: res.exitCode ?? 1, output: `${res.stdout || ""}\n${res.stderr || ""}` };
  });
  const res = await run(command);
  const ok = res.exitCode === 0;
  const verdict = ok ? "green" : `red (exit ${res.exitCode})`;
  emitProgress(emitter, makeEvent("tests:result", { ...eventBase, stage: "tests" }, {
    status: ok ? "ok" : "fail",
    message: `${command}: ${verdict}`,
    detail: { ran: true, ok, command, exitCode: res.exitCode, executorType: "local" },
  }));
  await addCheckpoint(session, { stage: "suite-green", iteration, ok, command });
  if (ok) return { action: "ok", result: { ran: true, ok: true, command } };
  const tail = String(res.output || "").trim().slice(-TAIL_CHARS);
  setReviewerFeedback(session, `The test suite is RED (${command}, exit ${res.exitCode}). Make it green before anything else:\n${tail}`);
  await saveSession(session);
  logger?.warn?.(`suite-green: ${command} exited ${res.exitCode}; back to the coder`);
  return { action: "continue", result: { ran: true, ok: false, command, exitCode: res.exitCode } };
}

// TDD discipline stage (KJC-TSK-0398 PR3).
// Runs the red-then-green check when `development.require_red_then_green`
// is true. Wraps `verifyTddDiscipline` with the surgical stash helper and
// the project's detected test framework. Gate is opt-in; an unsupported
// framework reports a warning and does not block the iteration.

import { detectTestFramework } from "../../utils/project-detect.js";
import { verifyTddDiscipline } from "../../review/tdd-discipline.js";
import { stashFilesAside, restoreFiles } from "../../review/git-stash-helper.js";
import { runCommand } from "../../utils/process.js";
import { emitProgress, makeEvent } from "../../utils/events.js";

const TDD_DISCIPLINE_COMMANDS = {
  vitest: ["npx", ["vitest", "run", "--reporter=verbose"]],
  jest: ["npx", ["jest", "--verbose"]],
  pytest: ["pytest", ["--tb=short"]],
};

export async function runTddDisciplineStage({
  config, logger, emitter, eventBase, sourceFiles = [], testFiles = [],
  detectFramework = detectTestFramework,
  runTestsImpl,
  stashImpl = stashFilesAside,
  restoreImpl = restoreFiles,
} = {}) {
  const projectDir = config?.projectDir || process.cwd();
  const detection = await detectFramework(projectDir);
  const framework = detection?.framework || null;

  const runTests = runTestsImpl || (async () => {
    const cmd = TDD_DISCIPLINE_COMMANDS[framework];
    if (!cmd) return { exitCode: 0, output: "" };
    const res = await runCommand(cmd[0], cmd[1], { cwd: projectDir, reject: false });
    return { exitCode: res.exitCode ?? 0, output: `${res.stdout || ""}\n${res.stderr || ""}` };
  });

  const result = await verifyTddDiscipline({
    projectDir, sourceFiles, testFiles, framework,
    runTests,
    stashFiles: (files) => stashImpl(files, { projectDir }),
    restoreFiles: (token) => restoreImpl(token, { projectDir }),
  });

  emitProgress(emitter, makeEvent("tdd:discipline", { ...eventBase, stage: "tdd" }, {
    status: result.ok ? "ok" : "fail",
    message: result.message || `TDD discipline: ${result.reason}`,
    detail: { reason: result.reason, framework },
  }));

  if (result.warning) logger?.warn?.(result.warning);
  if (!result.ok) {
    logger?.warn?.(`TDD discipline violation: ${result.reason}`);
    return { action: "continue", result };
  }
  return { action: "ok", result };
}

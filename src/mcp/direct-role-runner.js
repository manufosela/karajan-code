/**
 * Shared runner for direct role execution (discover, triage, researcher, architect, audit).
 * Extracts the repeated boilerplate from server-handlers.js handleXxxDirect functions.
 */

import { createStallDetector } from "../utils/stall-detector.js";
import { resolveRole } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { createRunLog } from "../utils/run-log.js";
import { sendTrackerLog } from "./progress.js";

/**
 * Run a role-based tool directly (not through the orchestrator pipeline).
 *
 * @param {object} opts
 * @param {string} opts.roleName     - Config role key (e.g. "discover", "triage")
 * @param {string} [opts.stage]      - Stage label for events/logs (defaults to roleName)
 * @param {Function} opts.importRole - Async fn returning { RoleClass } (dynamic import wrapper)
 * @param {object} opts.initContext  - Object passed to role.init()
 * @param {object} opts.runInput     - Object passed to role.run() (onOutput is injected automatically)
 * @param {string} [opts.logStartMsg] - Custom "[kj_xxx] started" suffix (optional)
 * @param {object} opts.args         - Raw tool arguments (for buildConfig overrides)
 * @param {string} [opts.commandName] - Config command name (defaults to roleName)
 * @param {object} opts.server       - MCP server instance
 * @param {object} opts.extra        - MCP extra context (for progress notifier)
 * @param {Function} opts.resolveProjectDir - Async fn(server, explicitDir) => projectDir
 * @param {Function} opts.buildConfig       - Async fn(args, commandName) => config
 * @param {Function} opts.buildDirectEmitter - fn(server, runLog, extra) => emitter
 */
export async function runDirectRole({
  roleName,
  stage,
  importRole,
  initContext,
  runInput,
  logStartMsg,
  args,
  commandName,
  server,
  extra,
  resolveProjectDir,
  buildConfig,
  buildDirectEmitter
}) {
  const effectiveStage = stage || roleName;
  const effectiveCommand = commandName || roleName;

  const config = await buildConfig(args, effectiveCommand);
  const logger = createLogger(config.output.log_level, "mcp");

  const role = resolveRole(config, roleName);
  await assertAgentsAvailable([role.provider]);

  const projectDir = await resolveProjectDir(server, args.projectDir);
  const runLog = createRunLog(projectDir);
  const startMsg = logStartMsg || `[kj_${effectiveStage}] started`;
  runLog.logText(startMsg);

  const emitter = buildDirectEmitter(server, runLog, extra);
  const eventBase = { sessionId: null, iteration: 0, startedAt: Date.now() };
  const onOutput = ({ stream, line }) => {
    emitter.emit("progress", {
      type: "agent:output",
      stage: effectiveStage,
      message: line,
      detail: { stream, agent: role.provider }
    });
  };
  const stallDetector = createStallDetector({
    onOutput, emitter, eventBase, stage: effectiveStage, provider: role.provider
  });

  const { RoleClass } = await importRole();
  const roleInstance = new RoleClass({ config, logger, emitter });
  await roleInstance.init(initContext);

  sendTrackerLog(server, effectiveStage, "running", role.provider);
  runLog.logText(`[${effectiveStage}] agent launched, waiting for response...`);

  let result;
  try {
    result = await roleInstance.run({ ...runInput, onOutput: stallDetector.onOutput });
  } finally {
    stallDetector.stop();
    const stats = stallDetector.stats();
    runLog.logText(
      `[${effectiveStage}] finished — lines=${stats.lineCount}, bytes=${stats.bytesReceived}, elapsed=${Math.round(stats.elapsedMs / 1000)}s`
    );
    runLog.close();
  }

  if (!result.ok) {
    sendTrackerLog(server, effectiveStage, "failed");
    throw new Error(result.result?.error || result.summary || `${effectiveStage} failed`);
  }

  sendTrackerLog(server, effectiveStage, "done");
  return { ok: true, ...result.result, summary: result.summary };
}

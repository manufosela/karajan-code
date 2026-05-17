import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on researching the codebase."
].join(" ");

function buildResearchPrompt(task) {
  return [
    SUBAGENT_PREAMBLE,
    "Investigate the codebase for the following task.",
    "Identify affected files, patterns, constraints, prior decisions, risks, and test coverage.",
    "Return a single valid JSON object with your findings and nothing else.",
    '{"affected_files":[string],"patterns":[string],"constraints":[string],"prior_decisions":[string],"risks":[string],"test_coverage":string}',
    `## Task\n${task}`
  ].join("\n\n");
}

export async function researcherCommand({ task, config, logger }) {
  const { withCliRunLog } = await import("../utils/cli-run-log.js");
  return withCliRunLog("researcher", { projectDir: config?.projectDir, logger }, async ({ runLog }) => {
    const researcherRole = resolveRole(config, "researcher");
    await assertAgentsAvailable([researcherRole.provider]);
    logger.info(`Researcher (${researcherRole.provider}) starting...`);
    runLog.logText(`[researcher] provider=${researcherRole.provider}`);

    const agent = createAgent(researcherRole.provider, config, logger);
    const prompt = buildResearchPrompt(task);
    const progress = createCliProgressReporter({ role: "researcher" });
    let result;
    try {
      result = await withBrainRecovery({
        agent, taskArgs: { prompt, onOutput: progress.onOutput, role: "researcher" },
        role: "researcher", provider: researcherRole.provider, logger,
      });
      progress.finish(result.ok ? "done" : (result.action || "failed"));
    } catch (err) { progress.finish("failed"); throw err; }

    if (!result.ok) {
      throw new Error(result.error || result.output || "Researcher failed");
    }

    if (result.output) {
      console.log(result.output);
    }
    logger.info("Researcher completed.");
    return { ok: true };
  });
}

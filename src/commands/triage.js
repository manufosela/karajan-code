import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";
import { buildTriagePrompt } from "../prompts/triage.js";
import { parseMaybeJsonString } from "../review/parser.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";

function formatTriage(result) {
  const lines = [];
  lines.push(`## Triage Result`);
  lines.push(`- **Level:** ${result.level || "unknown"}`);
  if (result.taskType) lines.push(`- **Task type:** ${result.taskType}`);
  if (result.reasoning) lines.push(`- **Reasoning:** ${result.reasoning}`);
  lines.push("");

  if (result.roles?.length) {
    lines.push("### Recommended Roles");
    for (const r of result.roles) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

  if (result.shouldDecompose) {
    lines.push("### Decomposition Suggested");
    if (result.subtasks?.length) {
      for (const s of result.subtasks) {
        lines.push(`- ${typeof s === "string" ? s : s.title || s}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function triageCommand({ task, config, logger, json }) {
  const { withCliRunLog } = await import("../utils/cli-run-log.js");
  return withCliRunLog("triage", { projectDir: config?.projectDir, logger }, async ({ runLog }) => {
    const triageRole = resolveRole(config, "triage");
    await assertAgentsAvailable([triageRole.provider]);
    logger.info(`Triage (${triageRole.provider}) starting...`);
    runLog.logText(`[triage] provider=${triageRole.provider}`);

    const agent = createAgent(triageRole.provider, config, logger);
    const prompt = buildTriagePrompt({ task });
    const progress = createCliProgressReporter({ role: "triage" });
    let result;
    try {
      result = await withBrainRecovery({
        agent, taskArgs: { prompt, onOutput: progress.onOutput, role: "triage" },
        role: "triage", provider: triageRole.provider, logger,
      });
      progress.finish(result.ok ? "done" : (result.action || "failed"));
    } catch (err) { progress.finish("failed"); throw err; }

    if (!result.ok) {
      throw new Error(result.error || result.output || "Triage failed");
    }

    const parsed = parseMaybeJsonString(result.output);
    if (parsed?.level) runLog.logText(`[triage] level=${parsed.level} roles=${(parsed.roles || []).join(",")}`);

    if (json) {
      console.log(JSON.stringify(parsed || result.output, null, 2));
      return { ok: true };
    }

    if (parsed?.level) {
      console.log(formatTriage(parsed));
    } else {
      console.log(result.output);
    }
    logger.info("Triage completed.");
    return { ok: true };
  });
}

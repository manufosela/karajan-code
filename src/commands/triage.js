import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { buildTriagePrompt } from "../prompts/triage.js";
import { parseMaybeJsonString } from "../review/parser.js";

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
  const triageRole = resolveRole(config, "triage");
  await assertAgentsAvailable([triageRole.provider]);
  logger.info(`Triage (${triageRole.provider}) starting...`);

  const agent = createAgent(triageRole.provider, config, logger);
  const prompt = buildTriagePrompt({ task });
  const onOutput = ({ line }) => process.stdout.write(`${line}\n`);
  const result = await agent.runTask({ prompt, onOutput, role: "triage" });

  if (!result.ok) {
    throw new Error(result.error || result.output || "Triage failed");
  }

  const parsed = parseMaybeJsonString(result.output);

  if (json) {
    console.log(JSON.stringify(parsed || result.output, null, 2));
    return;
  }

  if (parsed?.level) {
    console.log(formatTriage(parsed));
  } else {
    console.log(result.output);
  }
  logger.info("Triage completed.");
}

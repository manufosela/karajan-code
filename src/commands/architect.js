import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { buildArchitectPrompt, parseArchitectOutput } from "../prompts/architect.js";

function formatArchitect(result) {
  const lines = [];
  lines.push(`## Architecture Design`);
  lines.push(`**Verdict:** ${result.verdict || "unknown"}`, "");

  const arch = result.architecture;
  if (arch) {
    if (arch.type) lines.push(`**Type:** ${arch.type}`, "");

    if (arch.layers?.length) {
      lines.push("### Layers");
      for (const l of arch.layers) {
        if (typeof l === "string") {
          lines.push(`- ${l}`);
        } else {
          lines.push(`- **${l.name}**: ${l.responsibility || ""}`);
        }
      }
      lines.push("");
    }

    if (arch.patterns?.length) {
      lines.push("### Patterns");
      for (const p of arch.patterns) lines.push(`- ${p}`);
      lines.push("");
    }

    if (arch.tradeoffs?.length) {
      lines.push("### Tradeoffs");
      for (const t of arch.tradeoffs) {
        lines.push(`- **${t.decision}**: ${t.rationale || ""}`);
        if (t.alternatives?.length) lines.push(`  Alternatives: ${t.alternatives.join(", ")}`);
      }
      lines.push("");
    }

    if (arch.apiContracts?.length) {
      lines.push("### API Contracts");
      for (const c of arch.apiContracts) {
        lines.push(`- \`${c.method || "GET"} ${c.endpoint}\``);
      }
      lines.push("");
    }
  }

  if (result.questions?.length) {
    lines.push("### Clarification Questions");
    for (const q of result.questions) {
      lines.push(`- ${q.question || q}`);
    }
    lines.push("");
  }

  if (result.summary) lines.push(`---\n${result.summary}`);
  return lines.join("\n");
}

export async function architectCommand({ task, config, logger, context, json }) {
  const architectRole = resolveRole(config, "architect");
  await assertAgentsAvailable([architectRole.provider]);
  logger.info(`Architect (${architectRole.provider}) starting...`);

  const agent = createAgent(architectRole.provider, config, logger);
  const prompt = buildArchitectPrompt({ task, researchContext: context });
  const onOutput = ({ line }) => process.stdout.write(`${line}\n`);
  const result = await agent.runTask({ prompt, onOutput, role: "architect" });

  if (!result.ok) {
    throw new Error(result.error || result.output || "Architect failed");
  }

  const parsed = parseArchitectOutput(result.output);

  if (json) {
    console.log(JSON.stringify(parsed || result.output, null, 2));
    return;
  }

  if (parsed?.verdict) {
    console.log(formatArchitect(parsed));
  } else {
    console.log(result.output);
  }
  logger.info("Architect completed.");
}

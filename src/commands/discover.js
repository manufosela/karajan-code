import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { buildDiscoverPrompt, parseDiscoverOutput } from "../prompts/discover.js";
import { parseMaybeJsonString } from "../review/parser.js";

function formatDiscover(result, mode) {
  const lines = [];
  lines.push(`## Discovery (${mode})`);
  lines.push(`**Verdict:** ${result.verdict || "unknown"}`, "");

  if (result.gaps?.length) {
    lines.push("## Gaps");
    for (const g of result.gaps) {
      const sev = g.severity ? ` [${g.severity}]` : "";
      lines.push(`- ${g.description || g}${sev}`);
      if (g.suggestedQuestion) lines.push(`  → ${g.suggestedQuestion}`);
    }
    lines.push("");
  }

  if (result.momTestQuestions?.length) {
    lines.push("## Mom Test Questions");
    for (const q of result.momTestQuestions) {
      lines.push(`- ${q.question || q}`);
      if (q.rationale) lines.push(`  _${q.rationale}_`);
    }
    lines.push("");
  }

  if (result.wendelChecklist?.length) {
    lines.push("## Wendel Checklist");
    for (const w of result.wendelChecklist) {
      const icon = w.status === "pass" ? "✓" : w.status === "fail" ? "✗" : "?";
      lines.push(`- [${icon}] ${w.condition}: ${w.justification || ""}`);
    }
    lines.push("");
  }

  if (result.classification) {
    lines.push("## Classification");
    lines.push(`- Type: ${result.classification.type}`);
    if (result.classification.adoptionRisk) lines.push(`- Adoption risk: ${result.classification.adoptionRisk}`);
    if (result.classification.frictionEstimate) lines.push(`- Friction: ${result.classification.frictionEstimate}`);
    lines.push("");
  }

  if (result.jtbds?.length) {
    lines.push("## Jobs-to-be-Done");
    for (const j of result.jtbds) {
      lines.push(`- **${j.id || ""}**: ${j.functional || j}`);
    }
    lines.push("");
  }

  if (result.summary) lines.push(`---\n${result.summary}`);
  return lines.join("\n");
}

export async function discoverCommand({ task, config, logger, mode, json }) {
  const discoverRole = resolveRole(config, "discover");
  await assertAgentsAvailable([discoverRole.provider]);
  logger.info(`Discover (${discoverRole.provider}) starting — mode: ${mode || "gaps"}...`);

  const agent = createAgent(discoverRole.provider, config, logger);
  const prompt = buildDiscoverPrompt({ task, mode: mode || "gaps" });
  const onOutput = ({ line }) => process.stdout.write(`${line}\n`);
  const result = await agent.runTask({ prompt, onOutput, role: "discover" });

  if (!result.ok) {
    throw new Error(result.error || result.output || "Discover failed");
  }

  const parsed = parseDiscoverOutput(result.output);

  if (json) {
    console.log(JSON.stringify(parsed || result.output, null, 2));
    return;
  }

  if (parsed?.verdict) {
    console.log(formatDiscover(parsed, mode || "gaps"));
  } else {
    console.log(result.output);
  }
  logger.info("Discover completed.");
}

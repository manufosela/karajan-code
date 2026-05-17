import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";
import { buildDiscoverPrompt, parseDiscoverOutput } from "../prompts/discover.js";

function formatGaps(gaps, lines) {
  lines.push("## Gaps");
  for (const g of gaps) {
    const sev = g.severity ? ` [${g.severity}]` : "";
    lines.push(`- ${g.description || g}${sev}`);
    if (g.suggestedQuestion) lines.push(`  → ${g.suggestedQuestion}`);
  }
  lines.push("");
}

function formatMomTest(questions, lines) {
  lines.push("## Mom Test Questions");
  for (const q of questions) {
    lines.push(`- ${q.question || q}`);
    if (q.rationale) lines.push(`  _${q.rationale}_`);
  }
  lines.push("");
}

function formatWendel(checklist, lines) {
  lines.push("## Wendel Checklist");
  for (const w of checklist) {
    const icon = w.status === "pass" ? "✓" : w.status === "fail" ? "✗" : "?";
    lines.push(`- [${icon}] ${w.condition}: ${w.justification || ""}`);
  }
  lines.push("");
}

function formatClassification(classification, lines) {
  lines.push("## Classification");
  lines.push(`- Type: ${classification.type}`);
  if (classification.adoptionRisk) lines.push(`- Adoption risk: ${classification.adoptionRisk}`);
  if (classification.frictionEstimate) lines.push(`- Friction: ${classification.frictionEstimate}`);
  lines.push("");
}

function formatJtbds(jtbds, lines) {
  lines.push("## Jobs-to-be-Done");
  for (const j of jtbds) {
    lines.push(`- **${j.id || ""}**: ${j.functional || j}`);
  }
  lines.push("");
}

function formatDiscover(result, mode) {
  const lines = [];
  lines.push(`## Discovery (${mode})`);
  lines.push(`**Verdict:** ${result.verdict || "unknown"}`, "");

  if (result.gaps?.length) formatGaps(result.gaps, lines);
  if (result.momTestQuestions?.length) formatMomTest(result.momTestQuestions, lines);
  if (result.wendelChecklist?.length) formatWendel(result.wendelChecklist, lines);
  if (result.classification) formatClassification(result.classification, lines);
  if (result.jtbds?.length) formatJtbds(result.jtbds, lines);
  if (result.summary) lines.push(`---\n${result.summary}`);
  return lines.join("\n");
}

export async function discoverCommand({ task, config, logger, mode, json }) {
  const { withCliRunLog } = await import("../utils/cli-run-log.js");
  return withCliRunLog("discover", { projectDir: config?.projectDir, logger }, async ({ runLog }) => {
    const discoverRole = resolveRole(config, "discover");
    await assertAgentsAvailable([discoverRole.provider]);
    logger.info(`Discover (${discoverRole.provider}) starting — mode: ${mode || "gaps"}...`);
    runLog.logText(`[discover] provider=${discoverRole.provider} mode=${mode || "gaps"}`);

    const agent = createAgent(discoverRole.provider, config, logger);
    const prompt = buildDiscoverPrompt({ task, mode: mode || "gaps" });
    const progress = createCliProgressReporter({ role: "discover" });
    let result;
    try {
      result = await withBrainRecovery({
        agent, taskArgs: { prompt, onOutput: progress.onOutput, role: "discover" },
        role: "discover", provider: discoverRole.provider, logger,
      });
      progress.finish(result.ok ? "done" : (result.action || "failed"));
    } catch (err) { progress.finish("failed"); throw err; }

    if (!result.ok) {
      throw new Error(result.error || result.output || "Discover failed");
    }

    const parsed = parseDiscoverOutput(result.output);

    if (json) {
      console.log(JSON.stringify(parsed || result.output, null, 2));
      return { ok: true };
    }

    if (parsed?.verdict) {
      console.log(formatDiscover(parsed, mode || "gaps"));
    } else {
      console.log(result.output);
    }
    logger.info("Discover completed.");
    return { ok: true };
  });
}

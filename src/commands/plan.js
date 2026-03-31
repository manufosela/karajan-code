import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { buildPlannerPrompt } from "../prompts/planner.js";
import { parseMaybeJsonString } from "../review/parser.js";

function formatPlan(plan) {
  const lines = [];

  if (plan.approach) {
    lines.push("## Approach", plan.approach, "");
  }

  if (plan.steps?.length) {
    lines.push("## Steps");
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const commit = step.commit ? ` → \`${step.commit}\`` : "";
      lines.push(`${i + 1}. ${step.description}${commit}`);
    }
    lines.push("");
  }

  if (plan.risks?.length) {
    lines.push("## Risks");
    for (const risk of plan.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  if (plan.outOfScope?.length) {
    lines.push("## Out of scope");
    for (const item of plan.outOfScope) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function planCommand({ task, config, logger, json, context }) {
  const plannerRole = resolveRole(config, "planner");
  await assertAgentsAvailable([plannerRole.provider]);

  const planner = createAgent(plannerRole.provider, config, logger);
  const prompt = buildPlannerPrompt({ task, context });
  const silenceTimeoutMs = Number(config?.session?.max_agent_silence_minutes) > 0
    ? Math.round(Number(config.session.max_agent_silence_minutes) * 60 * 1000)
    : undefined;
  const timeoutMs = Number(config?.session?.max_planner_minutes) > 0
    ? Math.round(Number(config.session.max_planner_minutes) * 60 * 1000)
    : undefined;
  const result = await planner.runTask({ prompt, role: "planner", silenceTimeoutMs, timeoutMs });

  if (!result.ok) {
    throw new Error(result.error || result.output || "Planner failed");
  }

  const parsed = parseMaybeJsonString(result.output);

  // Persist plan
  let planId = null;
  try {
    const { savePlan } = await import("../plan/plan-store.js");
    const projectDir = config.projectDir || process.cwd();
    planId = await savePlan(projectDir, {
      task,
      researchContext: null,
      architectContext: null,
      plan: parsed || result.output,
      raw: result.output
    });
  } catch (err) {
    logger.warn(`Plan persistence failed: ${err.message}`);
  }

  if (json) {
    const jsonOutput = parsed || result.output;
    const outputObj = typeof jsonOutput === "object" ? { ...jsonOutput, planId } : { plan: jsonOutput, planId };
    console.log(JSON.stringify(outputObj, null, 2));
    return;
  }

  if (parsed?.approach) {
    console.log(formatPlan(parsed));
  } else {
    console.log(result.output);
  }

  if (planId) {
    console.log(`\nPlan saved: ${planId}`);
    console.log(`Use it with: kj run --plan ${planId} "<task>"`);
  }
}

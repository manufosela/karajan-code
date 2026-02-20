import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";

export async function planCommand({ task, config, logger }) {
  const plannerRole = resolveRole(config, "planner");
  await assertAgentsAvailable([plannerRole.provider]);
  const planner = createAgent(plannerRole.provider, config, logger);
  const prompt = `Create an implementation plan for this task:\n\n${task}\n\nOutput concise numbered steps.`;
  const result = await planner.runTask({ prompt, role: "planner" });
  if (!result.ok) {
    throw new Error(result.error || result.output || "Planner failed");
  }
  console.log(result.output);
}

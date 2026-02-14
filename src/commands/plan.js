import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";

export async function planCommand({ task, config, logger }) {
  await assertAgentsAvailable([config.coder]);
  const planner = createAgent(config.coder, config, logger);
  const prompt = `Create an implementation plan for this task:\n\n${task}\n\nOutput concise numbered steps.`;
  const result = await planner.runTask({ prompt });
  if (!result.ok) {
    throw new Error(result.error || result.output || "Planner failed");
  }
  console.log(result.output);
}

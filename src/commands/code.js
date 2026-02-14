import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { buildCoderPrompt } from "../prompts/coder.js";

export async function codeCommand({ task, config, logger }) {
  await assertAgentsAvailable([config.coder]);
  const coder = createAgent(config.coder, config, logger);
  const prompt = buildCoderPrompt({ task });
  const result = await coder.runTask({ prompt });
  if (!result.ok) {
    throw new Error(result.error || result.output || "Coder failed");
  }
  logger.info("Coder completed");
}

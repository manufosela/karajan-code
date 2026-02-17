import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { buildCoderPrompt } from "../prompts/coder.js";

export async function codeCommand({ task, config, logger }) {
  await assertAgentsAvailable([config.coder]);
  logger.info(`Coder (${config.coder}) starting...`);
  const coder = createAgent(config.coder, config, logger);
  const prompt = buildCoderPrompt({ task, methodology: config.development?.methodology || "tdd" });
  const onOutput = ({ line }) => process.stdout.write(`${line}\n`);
  const result = await coder.runTask({ prompt, onOutput });
  if (!result.ok) {
    if (result.error) logger.error(result.error);
    throw new Error(result.error || result.output || `Coder failed (exit ${result.exitCode})`);
  }
  if (result.output) {
    console.log(result.output);
  }
  if (result.error) {
    logger.warn(result.error);
  }
  logger.info(`Coder completed (exit ${result.exitCode})`);
}

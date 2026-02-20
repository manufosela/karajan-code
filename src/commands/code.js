import fs from "node:fs/promises";
import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { buildCoderPrompt } from "../prompts/coder.js";
import { resolveRole } from "../config.js";

export async function codeCommand({ task, config, logger }) {
  const coderRole = resolveRole(config, "coder");
  await assertAgentsAvailable([coderRole.provider]);
  logger.info(`Coder (${coderRole.provider}) starting...`);
  const coder = createAgent(coderRole.provider, config, logger);
  let coderRules = null;
  if (config.coder_rules) {
    try {
      coderRules = await fs.readFile(config.coder_rules, "utf8");
    } catch { /* no coder rules file, that's ok */ }
  }
  const prompt = buildCoderPrompt({ task, coderRules, methodology: config.development?.methodology || "tdd" });
  const onOutput = ({ line }) => process.stdout.write(`${line}\n`);
  const result = await coder.runTask({ prompt, onOutput, role: "coder" });
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

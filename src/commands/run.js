import { runFlow } from "../orchestrator.js";
import { assertAgentsAvailable } from "../agents/availability.js";

export async function runCommandHandler({ task, config, logger, flags }) {
  await assertAgentsAvailable([config.coder, config.reviewer, config.reviewer_options?.fallback_reviewer]);
  const result = await runFlow({ task, config, logger, flags });
  console.log(JSON.stringify(result, null, 2));
}

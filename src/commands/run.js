import { runFlow } from "../orchestrator.js";

export async function runCommandHandler({ task, config, logger, flags }) {
  const result = await runFlow({ task, config, logger, flags });
  console.log(JSON.stringify(result, null, 2));
}

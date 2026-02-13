import { resumeFlow } from "../orchestrator.js";

export async function resumeCommand({ sessionId, logger }) {
  const session = await resumeFlow({ sessionId, logger });
  console.log(JSON.stringify(session, null, 2));
}

import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on researching the codebase."
].join(" ");

function buildResearchPrompt(task) {
  return [
    SUBAGENT_PREAMBLE,
    "Investigate the codebase for the following task.",
    "Identify affected files, patterns, constraints, prior decisions, risks, and test coverage.",
    "Return a single valid JSON object with your findings and nothing else.",
    '{"affected_files":[string],"patterns":[string],"constraints":[string],"prior_decisions":[string],"risks":[string],"test_coverage":string}',
    `## Task\n${task}`
  ].join("\n\n");
}

export async function researcherCommand({ task, config, logger }) {
  const researcherRole = resolveRole(config, "researcher");
  await assertAgentsAvailable([researcherRole.provider]);
  logger.info(`Researcher (${researcherRole.provider}) starting...`);

  const agent = createAgent(researcherRole.provider, config, logger);
  const prompt = buildResearchPrompt(task);
  const onOutput = ({ line }) => process.stdout.write(`${line}\n`);
  const result = await agent.runTask({ prompt, onOutput, role: "researcher" });

  if (!result.ok) {
    throw new Error(result.error || result.output || "Researcher failed");
  }

  if (result.output) {
    console.log(result.output);
  }
  logger.info("Researcher completed.");
}

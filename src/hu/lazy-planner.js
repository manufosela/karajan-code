/**
 * Lazy HU Planner — refines HUs one at a time using context from completed HUs.
 *
 * Instead of fully planning all HUs upfront, only the first HU is decomposed
 * with full acceptance criteria. Subsequent HUs are refined lazily before
 * execution, incorporating learnings from previously completed HUs.
 */
import { createAgent } from "../agents/index.js";
import { extractFirstJson } from "../utils/json-extract.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on refining the user story."
].join(" ");

/**
 * Build a prompt asking the AI to refine an HU based on context from completed HUs.
 * @param {object} hu - The HU to refine (with at least id, original.text or certified.text).
 * @param {Array<object>} completedHus - Array of completed HU results with summaries.
 * @returns {string} The assembled refinement prompt.
 */
export function buildRefinementPrompt(hu, completedHus) {
  const sections = [SUBAGENT_PREAMBLE];

  sections.push("## HU Refinement");
  sections.push(
    "You are a senior product owner. Refine the following user story by adding or updating its acceptance criteria.",
    "Use the context from previously completed HUs to make the criteria more precise and avoid redundant work."
  );

  if (completedHus.length > 0) {
    sections.push("## Previously Completed HUs");
    for (const completed of completedHus) {
      const title = completed.certified?.title || completed.id;
      const summary = completed.resultSummary || completed.certified?.text || completed.original?.text || "No summary available";
      sections.push(`### ${completed.id} — ${title}\nResult: ${summary}`);
    }
  }

  const huText = hu.certified?.text || hu.original?.text || `Implement HU ${hu.id}`;
  sections.push(`## HU to Refine\n### ${hu.id}\n${huText}`);

  sections.push(
    "Return a single valid JSON object and nothing else.",
    `JSON schema: {"id":string,"title":string,"text":string,"acceptanceCriteria":[string]}`,
    "Rules:",
    "- Keep the same HU id",
    "- Refine the description to be more specific based on what was learned",
    "- Add concrete, testable acceptance criteria",
    "- Avoid repeating work already done in completed HUs",
    "- The text field should be the full story description ready for implementation"
  );

  return sections.join("\n\n");
}

/**
 * Refine an HU using AI, incorporating context from completed HUs.
 * @param {object} hu - The HU story object to refine.
 * @param {Array<object>} completedHus - Completed HU stories with results.
 * @param {object} config - Pipeline configuration.
 * @param {object} logger - Logger instance.
 * @returns {Promise<object>} Updated HU object with refined description and AC.
 */
export async function refineHuWithContext(hu, completedHus, config, logger) {
  const provider = config?.roles?.hu_reviewer?.provider || config?.roles?.coder?.provider || "claude";
  const prompt = buildRefinementPrompt(hu, completedHus);

  logger.info(`Lazy planner: refining HU ${hu.id} with context from ${completedHus.length} completed HU(s)`);

  const agent = createAgent(provider, config, logger);
  let result;
  try {
    result = await agent.runTask({ prompt, role: "hu-reviewer" });
  } catch (err) {
    logger.warn(`Lazy planner: refinement failed for HU ${hu.id}: ${err.message}`);
    return hu;
  }

  if (!result.ok) {
    logger.warn(`Lazy planner: refinement returned not-ok for HU ${hu.id}`);
    return hu;
  }

  const parsed = extractFirstJson(result.output);
  if (!parsed || !parsed.text) {
    logger.warn(`Lazy planner: could not parse refinement output for HU ${hu.id}`);
    return hu;
  }

  // Update the HU with refined content
  const refined = { ...hu };
  refined.certified = {
    ...(hu.certified || {}),
    text: parsed.text,
    title: parsed.title || hu.certified?.title || hu.id,
    acceptanceCriteria: parsed.acceptanceCriteria || []
  };
  refined.needsRefinement = false;

  logger.info(`Lazy planner: HU ${hu.id} refined successfully`);
  return refined;
}

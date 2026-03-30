import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on researching the codebase."
].join(" ");

function resolveProvider(config) {
  return (
    config?.roles?.researcher?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildPrompt({ task, instructions }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "Investigate the codebase for the following task.",
    "Identify affected files, patterns, constraints, prior decisions, risks, and test coverage.",
    "Return a single valid JSON object with your findings and nothing else.",
    'JSON schema: {"affected_files":[string],"patterns":[string],"constraints":[string],"prior_decisions":[string],"risks":[string],"test_coverage":string}',
    `## Task\n${task}`
  );

  return sections.join("\n\n");
}

function parseResearchOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

function buildSummary(parsed) {
  const files = parsed.affected_files?.length || 0;
  const risks = parsed.risks?.length || 0;
  const patterns = parsed.patterns?.length || 0;
  const parts = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (risks) parts.push(`${risks} risk${risks === 1 ? "" : "s"}`);
  if (patterns) parts.push(`${patterns} pattern${patterns === 1 ? "" : "s"}`);
  return parts.length
    ? `Research complete: ${parts.join(", ")} identified`
    : "Research complete";
}

export class ResearcherRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "researcher", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const task = typeof input === "string"
      ? input
      : input?.task || this.context?.task || "";
    const onOutput = typeof input === "string" ? null : input?.onOutput || null;

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildPrompt({ task, instructions: this.instructions });
    const runArgs = { prompt, role: "researcher" };
    if (onOutput) runArgs.onOutput = onOutput;
    const result = await agent.runTask(runArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Researcher failed",
          provider
        },
        summary: `Researcher failed: ${result.error || "unknown error"}`
      };
    }

    try {
      const parsed = parseResearchOutput(result.output);
      if (!parsed) {
        return {
          ok: true,
          result: {
            affected_files: [],
            patterns: [],
            constraints: [],
            prior_decisions: [],
            risks: [],
            test_coverage: "",
            raw: result.output,
            provider
          },
          summary: "Research complete (unstructured output)"
        };
      }

      return {
        ok: true,
        result: {
          affected_files: parsed.affected_files || [],
          patterns: parsed.patterns || [],
          constraints: parsed.constraints || [],
          prior_decisions: parsed.prior_decisions || [],
          risks: parsed.risks || [],
          test_coverage: parsed.test_coverage || "",
          provider
        },
        summary: buildSummary(parsed)
      };
    } catch { /* agent output is not structured JSON */
      return {
        ok: true,
        result: {
          affected_files: [],
          patterns: [],
          constraints: [],
          prior_decisions: [],
          risks: [],
          test_coverage: "",
          raw: result.output,
          provider
        },
        summary: "Research complete (unstructured output)"
      };
    }
  }
}

import { AgentRole } from "./agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on researching the codebase."
].join(" ");

const EMPTY_RESEARCH = {
  affected_files: [], patterns: [], constraints: [],
  prior_decisions: [], risks: [], test_coverage: ""
};

export class ResearcherRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "researcher" });
  }

  async buildPrompt({ task }) {
    const sections = [SUBAGENT_PREAMBLE];
    if (this.instructions) sections.push(this.instructions);
    sections.push(
      "Investigate the codebase for the following task.",
      "Identify affected files, patterns, constraints, prior decisions, risks, and test coverage.",
      "Return a single valid JSON object with your findings and nothing else.",
      '{"affected_files":[string],"patterns":[string],"constraints":[string],"prior_decisions":[string],"risks":[string],"test_coverage":string}',
      `## Task\n${task}`
    );
    return { prompt: sections.join("\n\n") };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  buildSuccessResult(parsed, provider) {
    return {
      affected_files: parsed.affected_files || [],
      patterns: parsed.patterns || [],
      constraints: parsed.constraints || [],
      prior_decisions: parsed.prior_decisions || [],
      risks: parsed.risks || [],
      test_coverage: parsed.test_coverage || "",
      provider
    };
  }

  buildSummary(parsed) {
    const files = parsed.affected_files?.length || 0;
    const risks = parsed.risks?.length || 0;
    const patterns = parsed.patterns?.length || 0;
    const parts = [];
    if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
    if (risks) parts.push(`${risks} risk${risks === 1 ? "" : "s"}`);
    if (patterns) parts.push(`${patterns} pattern${patterns === 1 ? "" : "s"}`);
    return parts.length ? `Research complete: ${parts.join(", ")} identified` : "Research complete";
  }

  handleParseNull(agentResult, provider) {
    return {
      ok: true,
      result: { ...EMPTY_RESEARCH, raw: agentResult.output, provider },
      summary: "Research complete (unstructured output)",
      usage: agentResult.usage
    };
  }

  handleParseError(_err, agentResult, provider) {
    return this.handleParseNull(agentResult, provider);
  }
}

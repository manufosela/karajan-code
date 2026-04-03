import { AgentRole } from "./agent-role.js";
import { buildArchitectPrompt, parseArchitectOutput } from "../prompts/architect.js";

const EMPTY_ARCHITECTURE = {
  type: "", layers: [], patterns: [], dataModel: { entities: [] },
  apiContracts: [], dependencies: [], tradeoffs: []
};

export class ArchitectRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "architect" });
  }

  extractInput(input) {
    if (typeof input === "string") return { task: input, researchContext: null, onOutput: null };
    return {
      task: input?.task || this.context?.task || "",
      researchContext: input?.researchContext || null,
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ task, researchContext }) {
    const prompt = await buildArchitectPrompt({
      task, instructions: this.instructions, researchContext,
      productContext: this.config?.productContext || null,
      domainContext: this.config?.domainContext || null
    });
    return { prompt };
  }

  parseOutput(raw) { return parseArchitectOutput(raw); }

  buildSuccessResult(parsed, provider) {
    return {
      verdict: parsed.verdict,
      architecture: parsed.architecture,
      questions: parsed.questions,
      provider
    };
  }

  buildSummary(parsed) {
    const parts = [];
    const arch = parsed.architecture;
    if (arch.type) parts.push(arch.type);
    const layers = arch.layers?.length || 0;
    if (layers) parts.push(`${layers} layer${layers === 1 ? "" : "s"}`);
    const patterns = arch.patterns?.length || 0;
    if (patterns) parts.push(`${patterns} pattern${patterns === 1 ? "" : "s"}`);
    const entities = arch.dataModel?.entities?.length || 0;
    if (entities) parts.push(`${entities} entit${entities === 1 ? "y" : "ies"}`);
    const questions = parsed.questions?.length || 0;
    if (questions) parts.push(`${questions} question${questions === 1 ? "" : "s"}`);
    return parts.length
      ? `Architecture complete: ${parts.join(", ")} (verdict: ${parsed.verdict})`
      : "Architecture complete";
  }

  handleParseNull(agentResult, provider) {
    return {
      ok: true,
      result: {
        verdict: "needs_clarification", architecture: { ...EMPTY_ARCHITECTURE },
        questions: [], raw: agentResult.output, provider
      },
      summary: "Architecture complete (unstructured output)",
      usage: agentResult.usage
    };
  }

  handleParseError(_err, agentResult, provider) {
    return this.handleParseNull(agentResult, provider);
  }
}

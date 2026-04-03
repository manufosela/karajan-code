import { AgentRole } from "./agent-role.js";
import { buildHuReviewerPrompt, parseHuReviewerOutput } from "../prompts/hu-reviewer.js";

const EMPTY_BATCH = { total: 0, certified: 0, needs_rewrite: 0, needs_context: 0, consolidated_questions: "" };

export class HuReviewerRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "hu-reviewer" });
  }

  resolveProvider() {
    return (
      this.config?.roles?.["hu-reviewer"]?.provider ||
      this.config?.roles?.hu_reviewer?.provider ||
      this.config?.roles?.coder?.provider ||
      "claude"
    );
  }

  extractInput(input) {
    return {
      stories: input?.stories || [],
      context: input?.context || null,
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ stories, context }) {
    const prompt = buildHuReviewerPrompt({
      stories, instructions: this.instructions, context,
      productContext: this.config?.productContext || null,
      domainContext: this.config?.domainContext || null
    });
    return { prompt };
  }

  parseOutput(raw) { return parseHuReviewerOutput(raw); }

  buildSuccessResult(parsed, provider) {
    return { evaluations: parsed.evaluations, batch_summary: parsed.batch_summary, provider };
  }

  buildSummary(parsed) {
    const bs = parsed.batch_summary;
    const parts = [`${bs.total} HU(s) evaluated`];
    if (bs.certified > 0) parts.push(`${bs.certified} certified`);
    if (bs.needs_rewrite > 0) parts.push(`${bs.needs_rewrite} need rewrite`);
    if (bs.needs_context > 0) parts.push(`${bs.needs_context} need context`);
    return `HU Review complete: ${parts.join(", ")}`;
  }

  handleParseNull(agentResult, provider) {
    return {
      ok: true,
      result: { evaluations: [], batch_summary: { ...EMPTY_BATCH }, raw: agentResult.output, provider },
      summary: "HU Review complete (unstructured output)",
      usage: agentResult.usage
    };
  }

  handleParseError(_err, agentResult, provider) {
    return this.handleParseNull(agentResult, provider);
  }
}

import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { buildHuReviewerPrompt, parseHuReviewerOutput } from "../prompts/hu-reviewer.js";

/**
 * Resolve the provider for the hu-reviewer role, falling back to coder.
 * @param {object} config
 * @returns {string}
 */
function resolveProvider(config) {
  return (
    config?.roles?.["hu-reviewer"]?.provider ||
    config?.roles?.hu_reviewer?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

/**
 * Build a human-readable summary from parsed evaluations.
 * @param {object} parsed - Parsed HU reviewer output.
 * @returns {string}
 */
function buildSummary(parsed) {
  const { batch_summary: bs } = parsed;
  const parts = [`${bs.total} HU(s) evaluated`];
  if (bs.certified > 0) parts.push(`${bs.certified} certified`);
  if (bs.needs_rewrite > 0) parts.push(`${bs.needs_rewrite} need rewrite`);
  if (bs.needs_context > 0) parts.push(`${bs.needs_context} need context`);
  return `HU Review complete: ${parts.join(", ")}`;
}

export class HuReviewerRole extends BaseRole {
  /**
   * @param {{config: object, logger: object, emitter?: object|null, createAgentFn?: Function|null}} params
   */
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "hu-reviewer", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  /**
   * Execute the HU review.
   * @param {{stories: Array<{id: string, text: string}>, context?: string|null, onOutput?: Function|null}} input
   * @returns {Promise<{ok: boolean, result: object, summary: string, usage?: object}>}
   */
  async execute(input) {
    const stories = input?.stories || [];
    const context = input?.context || null;
    const onOutput = input?.onOutput || null;

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildHuReviewerPrompt({ stories, instructions: this.instructions, context, productContext: this.config?.productContext || null });
    const runArgs = { prompt, role: "hu-reviewer" };
    if (onOutput) runArgs.onOutput = onOutput;
    const result = await agent.runTask(runArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "HU Review failed",
          provider
        },
        summary: `HU Review failed: ${result.error || "unknown error"}`,
        usage: result.usage
      };
    }

    try {
      const parsed = parseHuReviewerOutput(result.output);
      if (!parsed) {
        return {
          ok: true,
          result: {
            evaluations: [],
            batch_summary: { total: 0, certified: 0, needs_rewrite: 0, needs_context: 0, consolidated_questions: "" },
            raw: result.output,
            provider
          },
          summary: "HU Review complete (unstructured output)",
          usage: result.usage
        };
      }

      return {
        ok: true,
        result: {
          evaluations: parsed.evaluations,
          batch_summary: parsed.batch_summary,
          provider
        },
        summary: buildSummary(parsed),
        usage: result.usage
      };
    } catch {
      return {
        ok: true,
        result: {
          evaluations: [],
          batch_summary: { total: 0, certified: 0, needs_rewrite: 0, needs_context: 0, consolidated_questions: "" },
          raw: result.output,
          provider
        },
        summary: "HU Review complete (unstructured output)",
        usage: result.usage
      };
    }
  }
}

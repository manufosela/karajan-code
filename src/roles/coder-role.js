import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { buildCoderPrompt } from "../prompts/coder.js";

function resolveProvider(config) {
  return (
    config?.roles?.coder?.provider ||
    config?.coder ||
    "claude"
  );
}

export class CoderRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "coder", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const { task, reviewerFeedback, sonarSummary, deferredContext, onOutput } = typeof input === "string"
      ? { task: input, reviewerFeedback: null, sonarSummary: null, deferredContext: null, onOutput: null }
      : input || {};

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildCoderPrompt({
      task: task || this.context?.task || "",
      reviewerFeedback: reviewerFeedback || null,
      sonarSummary: sonarSummary || null,
      deferredContext: deferredContext || null,
      coderRules: this.instructions,
      methodology: this.config?.development?.methodology || "tdd",
      serenaEnabled: Boolean(this.config?.serena?.enabled)
    });

    const coderArgs = { prompt, role: "coder" };
    if (onOutput) coderArgs.onOutput = onOutput;

    const result = await agent.runTask(coderArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: {
          ...result,
          error: result.error || result.output || "Coder failed",
          provider
        },
        summary: `Coder failed: ${result.error || result.output || "unknown error"}`
      };
    }

    return {
      ok: true,
      result: {
        ...result,
        output: result.output || "",
        provider
      },
      summary: "Coder completed"
    };
  }
}

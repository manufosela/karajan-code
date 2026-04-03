import { AgentRole } from "./agent-role.js";
import { buildCoderPrompt } from "../prompts/coder.js";
import { isHostAgent } from "../utils/agent-detect.js";
import { HostAgent } from "../agents/host-agent.js";

export class CoderRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "coder" });
    this._askHost = opts.askHost || null;
  }

  resolveProvider() {
    return this.config?.roles?.coder?.provider || this.config?.coder || "claude";
  }

  createAgentInstance(provider) {
    if (this._askHost && isHostAgent(provider)) {
      this.logger.info(`Host-as-coder: delegating to host AI (skipping ${provider} subprocess)`);
      return new HostAgent(this.config, this.logger, { askHost: this._askHost });
    }
    return this._createAgent(provider, this.config, this.logger);
  }

  extractInput(input) {
    if (typeof input === "string") return { task: input, reviewerFeedback: null, sonarSummary: null, deferredContext: null, onOutput: null };
    return {
      task: input?.task || this.context?.task || "",
      reviewerFeedback: input?.reviewerFeedback || null,
      sonarSummary: input?.sonarSummary || null,
      deferredContext: input?.deferredContext || null,
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ task, reviewerFeedback, sonarSummary, deferredContext }) {
    const prompt = await buildCoderPrompt({
      task, reviewerFeedback, sonarSummary, deferredContext,
      coderRules: this.instructions,
      methodology: this.config?.development?.methodology || "tdd",
      serenaEnabled: Boolean(this.config?.serena?.enabled),
      rtkAvailable: Boolean(this.config?.rtk?.available),
      productContext: this.config?.productContext || null,
      domainContext: this.config?.domainContext || null
    });
    return { prompt };
  }

  buildSuccessResult(parsed, provider, agentResult) {
    return { ...agentResult, output: agentResult.output || "", provider };
  }

  buildSummary() { return "Coder completed"; }
}

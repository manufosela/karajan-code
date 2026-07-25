import { AgentRole } from "./agent-role.js";
import { buildCoderPromptLayout } from "../prompts/coder.js";
import { joinLayout } from "../prompts/prompt-layout.js";
import { isHostAgent } from "../utils/agent-detect.js";
import { HostAgent } from "../agents/host-agent.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { detectTestFramework } from "../utils/project-detect.js";

export class CoderRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "coder" });
    this._askHost = opts.askHost || null;
  }

  resolveProvider() {
    return this.config?.roles?.coder?.provider || this.config?.coder || "claude";
  }

  createAgentInstance(provider) {
    // KJC-BUG-0129 (issues #1301/#1303): running INSIDE an agent does not
    // make it "the host executor" — delegating sent the full instruction
    // prompt through elicitInput as a hanging board "question". A CLI
    // provider spawns as a subprocess ALWAYS; host delegation is explicit
    // opt-in (roles.coder.host_delegation: true) for MCP-only setups.
    if (this._askHost && isHostAgent(provider)) {
      if (this.config?.roles?.coder?.host_delegation === true) {
        this.logger.info(`Host-as-coder: delegating to host AI (roles.coder.host_delegation, skipping ${provider} subprocess)`);
        return new HostAgent(this.config, this.logger, { askHost: this._askHost });
      }
      this.logger.info(`Running inside ${provider} — spawning it as a subprocess anyway (set roles.coder.host_delegation: true to delegate to the host)`);
    }
    return this._createAgent(provider, this.config, this.logger);
  }

  extractInput(input) {
    if (typeof input === "string") {
      return {
        task: input,
        reviewerFeedback: null, sonarSummary: null, deferredContext: null,
        acceptanceTests: null,
        adrs: null, specSection: null, reviewerFindings: null, huId: null,
        projectDir: null,
        onOutput: null
      };
    }
    return {
      task: input?.task || this.context?.task || "",
      reviewerFeedback: input?.reviewerFeedback || null,
      sonarSummary: input?.sonarSummary || null,
      deferredContext: input?.deferredContext || null,
      // Tests-first (v2.7.5): the coder reads these as the gate it
      // must satisfy. Only the plan-backed HU path populates this;
      // the standard single-task `kj run` flow leaves it null.
      acceptanceTests: input?.acceptanceTests || null,
      // PR F (v2.7.5): per-HU planning context. ADRs constrain HOW,
      // specSection ties this HU to a SPEC heading, reviewerFindings
      // are filtered to entries that mention this HU. All four are
      // null for non-plan-backed runs, which keeps the legacy flow
      // byte-for-byte identical.
      adrs: Array.isArray(input?.adrs) ? input.adrs : null,
      specSection: input?.specSection || null,
      reviewerFindings: input?.reviewerFindings || null,
      huId: input?.huId || null,
      // PAR-E2 (KJC-TSK-0629): per-call project root. Worktree lanes pass
      // their lane dir here; the shared role instance keeps its own config.
      projectDir: input?.projectDir || null,
      // PAR-H (KJC-TSK-0631): per-call subprocess env (lane slot vars).
      env: input?.env || null,
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ task, reviewerFeedback, sonarSummary, deferredContext, acceptanceTests, adrs, specSection, reviewerFindings, huId, projectDir: laneProjectDir }) {
    const projectDir = laneProjectDir || this.config?.projectDir || null;
    // KJC sesgo-de-stack: pasar stack/testFramework al prompt para que
    // el coder no asuma JS/vitest en proyectos Python / Go / Rust /
    // Ruby. audit-role.js y tester-role.js ya lo hacen así.
    let stack = null;
    let testFramework = null;
    if (projectDir) {
      try { stack = await detectProjectStack(projectDir); } catch { /* best-effort */ }
      try { testFramework = await detectTestFramework(projectDir); } catch { /* best-effort */ }
    }
    const layout = await buildCoderPromptLayout({
      task, reviewerFeedback, sonarSummary, deferredContext, acceptanceTests,
      adrs, specSection, reviewerFindings, huId,
      coderRules: this.instructions,
      methodology: this.config?.development?.methodology || "tdd",
      serenaEnabled: Boolean(this.config?.serena?.enabled),
      rtkAvailable: Boolean(this.config?.rtk?.available),
      productContext: this.config?.productContext || null,
      domainContext: this.config?.domainContext || null,
      projectDir,
      stack, testFramework,
      provider: this._resolvedProvider || (typeof this.resolveProvider === "function" ? this.resolveProvider() : null)
    });
    // Φ1-D: prompt is the joined layout (identical for every agent);
    // the buckets ride along so ClaudeAgent can system-split them.
    return { prompt: joinLayout(layout), stablePrompt: layout.stable, volatilePrompt: layout.volatile };
  }

  buildSuccessResult(parsed, provider, agentResult) {
    return { ...agentResult, output: agentResult.output || "", provider };
  }

  buildSummary() { return "Coder completed"; }
}

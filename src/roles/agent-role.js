/**
 * Base class for LLM-backed roles.
 * Handles the common execute() flow: resolve provider → create agent → call LLM → parse output.
 * Subclasses override hooks (buildPrompt, parseOutput, buildSuccessResult, buildSummary)
 * instead of reimplementing the full execute() boilerplate.
 */
import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

export class AgentRole extends BaseRole {
  constructor({ name, config, logger, emitter = null, createAgentFn = null }) {
    super({ name, config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  /** Provider fallback chain. Override for roles with non-standard chains. */
  resolveProvider() {
    return (
      this.config?.roles?.[this.name]?.provider ||
      this.config?.roles?.coder?.provider ||
      "claude"
    );
  }

  /** Agent method to call. Override with "reviewTask" for reviewer. */
  get agentMethod() { return "runTask"; }

  /** Create the agent. Override for special logic (e.g. HostAgent in coder). */
  createAgentInstance(provider) {
    return this._createAgent(provider, this.config, this.logger);
  }

  /**
   * Build the prompt for this role. MUST be overridden.
   * @param {*} input - raw input from pipeline
   * @returns {Promise<{prompt: string, onOutput?: Function}>|{prompt: string, onOutput?: Function}|string}
   */
  async buildPrompt(_input) {
    throw new Error(`${this.name}: buildPrompt() not implemented`);
  }

  /**
   * Parse raw LLM output into structured data. Return null to trigger handleParseNull.
   * @param {string} raw - raw agent output
   * @returns {*} parsed result
   */
  parseOutput(raw) { return raw; }

  /**
   * Build the result object for a successful parse.
   * @param {*} parsed - output of parseOutput
   * @param {string} provider
   * @param {object} agentResult - full agent result (for accessing .usage, .output, etc.)
   * @returns {object} result to include in { ok, result, summary, usage }
   */
  buildSuccessResult(parsed, provider, _agentResult) { return { ...parsed, provider }; }

  /** Build human-readable summary from parsed output. */
  buildSummary(_parsed) { return `${this.name} completed`; }

  /** Determine ok status from parsed result. Default: true. Override for verdict-based roles. */
  isSuccessful(_parsed) { return true; }

  /** Handle null parse (no JSON found). Default returns error. Override for lenient roles. */
  handleParseNull(agentResult, provider) {
    return {
      ok: false,
      result: { error: `Failed to parse ${this.name} output: no JSON found`, provider },
      summary: `${this.name} output parse error: no JSON found`,
      usage: agentResult.usage
    };
  }

  /** Handle parse exception. Default returns error. Override for lenient roles. */
  handleParseError(err, agentResult, provider) {
    return {
      ok: false,
      result: { error: `Failed to parse ${this.name} output: ${err.message}`, provider },
      summary: `${this.name} output parse error: ${err.message}`,
      usage: agentResult.usage
    };
  }

  /**
   * Extract input fields from raw input. Default handles string-or-object.
   * Override for roles needing extra fields.
   */
  extractInput(input) {
    if (typeof input === "string") return { task: input, onOutput: null };
    return {
      task: input?.task || this.context?.task || "",
      onOutput: input?.onOutput || null,
      ...input
    };
  }

  async execute(input) {
    const extracted = this.extractInput(input);
    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);

    const promptResult = await this.buildPrompt(extracted);
    const { prompt, onOutput } = typeof promptResult === "string"
      ? { prompt: promptResult, onOutput: extracted.onOutput }
      : { onOutput: extracted.onOutput, ...promptResult };

    const runArgs = { prompt, role: this.name };
    if (onOutput) runArgs.onOutput = onOutput;

    const result = await agent[this.agentMethod](runArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: { error: result.error || result.output || `${this.name} failed`, provider },
        summary: `${this.name} failed: ${result.error || "unknown error"}`,
        usage: result.usage
      };
    }

    try {
      const parsed = this.parseOutput(result.output);
      if (parsed === null) return this.handleParseNull(result, provider);

      return {
        ok: this.isSuccessful(parsed),
        result: this.buildSuccessResult(parsed, provider, result),
        summary: this.buildSummary(parsed),
        usage: result.usage
      };
    } catch (err) {
      return this.handleParseError(err, result, provider);
    }
  }
}

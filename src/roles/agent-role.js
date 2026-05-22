/**
 * Base class for LLM-backed roles.
 * Handles the common execute() flow: resolve provider → create agent → call LLM → parse output.
 * Subclasses override hooks (buildPrompt, parseOutput, buildSuccessResult, buildSummary)
 * instead of reimplementing the full execute() boilerplate.
 *
 * Conceptual mapping: `AgentRole` is a Karajan Role that delegates to an AI CLI
 * subprocess (not to a provider HTTP API). From the outside it plays the same
 * role as a Genkit Flow — named unit of work with a prompt and a parsed output —
 * but every invocation spawns a fresh `execa` subprocess (claude, codex, gemini,
 * aider, opencode) and the state lives in Karajan's session store, not in a
 * provider-side conversation. See `docs/COMPARISON.md`.
 *
 * @alias Flow — similar to Genkit Flow but executed over subprocess CLIs, not API calls.
 */
import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";

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

    // KJC-TSK-0413 step B: TODAS las roles que heredan de AgentRole pasan
    // por Brain Recovery aquí — cubre AuditRole, SecurityRole, HuReviewerRole,
    // CoderRole, ArchitectRole, DiscoverRole, ImpeccableRole, RefactorerRole,
    // ResearcherRole, TriageRole, etc. Roles con agentMethod custom (ej.
    // reviewer usa reviewTask) también funcionan: el wrapper sólo necesita
    // un objeto con la firma `runTask(args) → { ok, output, error, exitCode }`.
    const result = await withBrainRecovery({
      agent: { runTask: (args) => agent[this.agentMethod](args), provider },
      taskArgs: runArgs,
      role: this.name,
      provider,
      emitter: this.emitter,
      logger: this.logger,
      // KJC: sessionState lets withBrainRecovery persist a hibernating run
      // to ~/.kj/standby/ so it can be resumed. Without it a quota-exhausted
      // run had nothing to resume from. Caller (coder-stage etc.) passes it
      // through the input object; extractInput forwards it via `...input`.
      sessionState: extracted.sessionState || this.context?.sessionState || null,
    });

    if (!result.ok) {
      const recoveryNote = result.recovery?.class ? ` [${result.recovery.class}]` : "";
      return {
        ok: false,
        result: { error: result.error || result.output || `${this.name} failed${recoveryNote}`, provider, recovery: result.recovery, action: result.action, standbyFile: result.standbyFile || null },
        summary: `${this.name} failed${recoveryNote}: ${result.recovery?.message || result.error || "unknown error"}`,
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

/**
 * Base class for provider-specific agent adapters (claude, codex, gemini, ...).
 * Every concrete agent must implement runTask() and may override reviewTask().
 *
 * @typedef {import("../types/config.js").KarajanConfig} KarajanConfig
 * @typedef {import("../types/stage.js").Logger} Logger
 * @typedef {import("../types/agent.js").AgentResult} AgentResult
 * @typedef {import("../infrastructure/environment.js").Environment} Environment
 * @typedef {import("../infrastructure/command-runner.js").CommandRunResult} CommandRunResult
 * @typedef {import("../infrastructure/command-runner.js").CommandRunOptions} CommandRunOptions
 */

import { defaultEnvironment } from "../infrastructure/environment.js";
import { buildAgentEnv } from "../utils/role-env.js";
import { isModelCompatible } from "../config/role-resolver.js";

const MODEL_NOT_SUPPORTED_PATTERNS = [
  /model.{0,30}is not supported/i,
  /model.{0,30}not available/i,
  /model.{0,30}does not exist/i,
  /unsupported model/i,
  /invalid model/i,
  /model_not_found/i
];

export class BaseAgent {
  /**
   * @param {string} name                    - agent slug (claude|codex|gemini|aider|opencode)
   * @param {KarajanConfig} config
   * @param {Logger} logger
   * @param {Environment} [environment]      - DI-friendly fs + runner bundle. Defaults
   *                                           to the native filesystem and execa-based
   *                                           command runner. Tests pass a mock env to
   *                                           unit-test agent paths without spawning
   *                                           real processes.
   */
  constructor(name, config, logger, environment = defaultEnvironment) {
    this.name = name;
    this.config = config;
    this.logger = logger;
    this.environment = environment;
  }

  /**
   * Run a shell command through the injected CommandRunner. Subclasses should
   * call this instead of importing runCommand directly so tests can swap in
   * MockCommandRunner.
   * @param {string} command
   * @param {string[]} [args]
   * @param {CommandRunOptions} [options]
   * @returns {Promise<CommandRunResult>}
   */
  async runCommand(command, args = [], options = {}) {
    // KJC-TSK-0693: the subprocess gets an env allowlist, never the user's
    // whole environment. security.env_allowlist:false opts out.
    if (this.config?.security?.env_allowlist !== false) {
      // Solomon-arbitrated contract (KJC-TSK-0693): an explicit env WITH a
      // PATH is a COMPLETE child env (agents build those from process.env and
      // deliberately strip vars — cleanExecaOpts drops CLAUDECODE, qwen
      // unsets gemini's trust var) and is filtered AS GIVEN. An env WITHOUT
      // a PATH is a partial overlay and merges over the inherited env first,
      // so an overlay caller can never cost the child PATH/HOME.
      const complete = options.env && ("PATH" in options.env || "Path" in options.env);
      const base = complete ? options.env : { ...process.env, ...options.env };
      options = {
        ...options,
        env: buildAgentEnv(base, {
          agent: this.name,
          passthrough: this.config?.security?.env_passthrough || [],
        }),
      };
    }
    return this.environment.runner.run(command, args, options);
  }

  /**
   * Execute a coding/agentic task. Subclasses MUST override.
   * @param {string|Object} _task
   * @returns {Promise<AgentResult>}
   */
  async runTask(_task) {
    throw new Error("runTask not implemented");
  }

  /**
   * Execute a review task. Subclasses MAY override for different behaviour.
   * @param {string|Object} _task
   * @returns {Promise<AgentResult>}
   */
  async reviewTask(_task) {
    throw new Error("reviewTask not implemented");
  }

  /**
   * @param {string} role
   * @returns {string|null}
   */
  getRoleModel(role) {
    const roleModel =
      this.config?.roles?.[role]?.model ||
      (role === "reviewer" ? this.config?.reviewer_options?.model : this.config?.coder_options?.model) ||
    null;
    // KJC-BUG-0144 (campo, issue #1465): un default por-rol (start: haiku)
    // puede caer sobre un provider de OTRA familia (agy, codex...) — el
    // modelo se descarta con aviso y el agente usa su propio default,
    // nunca se le pasa un --model ajeno.
    if (roleModel && !isModelCompatible(this.name, roleModel)) {
      this.logger?.warn?.(`model "${roleModel}" belongs to another family — dropping it for ${this.name} (role ${role})`);
      return null;
    }
    return roleModel;
  }

  /**
   * @param {string} role
   * @returns {boolean}
   */
  isAutoApproveEnabled(role) {
    if (role === "reviewer") return false;
    return Boolean(this.config?.coder_options?.auto_approve);
  }

  /**
   * Heuristic: does the agent's error look like "model not supported"?
   * Used by the retry/fallback path.
   * @param {Partial<AgentResult>} result
   * @returns {boolean}
   */
  isModelNotSupportedError(result) {
    const text = [result?.error, result?.output, result?.stderr, result?.stdout]
      .filter(Boolean).join("\n");
    return MODEL_NOT_SUPPORTED_PATTERNS.some(re => re.test(text));
  }
}

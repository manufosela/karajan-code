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
      // Merge explicit env over the inherited one BEFORE filtering: a caller
      // passing only lane vars must not cost the child PATH/HOME.
      options = {
        ...options,
        env: buildAgentEnv({ ...process.env, ...(options.env || {}) }, {
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
    const roleModel = this.config?.roles?.[role]?.model;
    if (roleModel) return roleModel;
    if (role === "reviewer") return this.config?.reviewer_options?.model || null;
    return this.config?.coder_options?.model || null;
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

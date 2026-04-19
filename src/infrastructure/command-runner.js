/**
 * CommandRunner — DI-friendly adapter over execa / runCommand.
 *
 * Why: agent adapters (claude, codex, gemini, ...) all end up invoking
 * src/utils/process.js -> runCommand. That makes unit-testing the agent layer
 * slow and flaky — every test either spins up a real child process or stubs
 * execa deep inside Vitest's module graph.
 *
 * This adapter preserves the runCommand API exactly, so current consumers
 * can opt-in to DI without behavioural changes. A matching MockCommandRunner
 * lives in src/infrastructure/mocks.js and lets tests script outputs per
 * invocation.
 *
 * @typedef {Object} CommandRunResult
 * @property {number} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} [timedOut]
 * @property {string|null} [signal]
 *
 * @typedef {Object} CommandRunOptions
 * @property {number} [timeout]
 * @property {(evt: {stream: string, line: string}) => void} [onOutput]
 * @property {number} [silenceTimeoutMs]
 * @property {number} [partialOutputFlushMs]
 * @property {string|Buffer} [input]
 * @property {string} [cwd]
 * @property {Record<string,string>} [env]
 *
 * @typedef {Object} CommandRunner
 * @property {(command: string, args?: string[], options?: CommandRunOptions) => Promise<CommandRunResult>} run
 */

import { runCommand } from "../utils/process.js";

/**
 * Default implementation — delegates to runCommand.
 * @type {CommandRunner}
 */
export const defaultCommandRunner = {
  async run(command, args = [], options = {}) {
    return runCommand(command, args, options);
  }
};

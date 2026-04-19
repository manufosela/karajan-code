/**
 * Environment — the DI bundle passed to services that need filesystem + command
 * execution. Grouping them keeps call sites small: `new BaseAgent(..., env)`
 * instead of `new BaseAgent(..., fs, runner)`.
 *
 * @typedef {import("./file-system-service.js").FileSystemService} FileSystemService
 * @typedef {import("./command-runner.js").CommandRunner} CommandRunner
 *
 * @typedef {Object} Environment
 * @property {FileSystemService} fs
 * @property {CommandRunner} runner
 */

import { defaultFileSystem } from "./file-system-service.js";
import { defaultCommandRunner } from "./command-runner.js";

/**
 * Default environment uses native fs + real execa-based runner.
 * Tests should inject a custom environment via buildEnvironment() below.
 * @type {Environment}
 */
export const defaultEnvironment = Object.freeze({
  fs: defaultFileSystem,
  runner: defaultCommandRunner
});

/**
 * Merge overrides on top of the default environment. Missing properties fall
 * back to defaults, so callers can replace only the pieces they care about.
 * @param {Partial<Environment>} [overrides]
 * @returns {Environment}
 */
export function buildEnvironment(overrides = {}) {
  return Object.freeze({
    fs: overrides.fs ?? defaultFileSystem,
    runner: overrides.runner ?? defaultCommandRunner
  });
}

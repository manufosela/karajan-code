/**
 * rulesync generate (ADR 0021, decision 11; ADR 0022): run only when atril.json declares
 * `rulesync.generate: true`, with the canonical arguments (whole generation), and never a package
 * fetched on the fly: the project's own binary, or `npx --no-install`.
 */
import { readConfig } from "./config.js";
import { defaultRun, runRulesync } from "./rulesync-cli.js";

const ARGS = ["generate", "--targets", "*", "--features", "*"];

/**
 * @param {{ projectDir?: string, root?: string, env?: object }} [opts]
 * @param {(cmd: string, args: string[], cwd: string) => unknown} [run]
 * @returns {boolean} whether rulesync generate ran
 */
export function generate(opts = {}, run = defaultRun) {
  if (readConfig(opts).rulesync.generate !== true) return false;
  const projectDir = opts.projectDir ?? process.cwd();
  try {
    runRulesync(ARGS, { projectDir }, run);
  } catch (err) {
    throw new Error(`rulesync generate failed (${err.message}); the pieces are in .rulesync/, run it yourself`, { cause: err });
  }
  return true;
}

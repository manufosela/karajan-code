import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(MODULE_DIR, "..", "cli.js");

function normalizeBoolFlag(value, flagName, args) {
  if (value === true) args.push(flagName);
}

function addOptionalValue(args, flag, value) {
  if (value !== undefined && value !== null && value !== "") {
    args.push(flag, String(value));
  }
}

export async function runKjCommand({ command, commandArgs = [], options = {}, env = {} }) {
  const args = [CLI_PATH, command, ...commandArgs];

  addOptionalValue(args, "--coder", options.coder);
  addOptionalValue(args, "--reviewer", options.reviewer);
  addOptionalValue(args, "--reviewer-fallback", options.reviewerFallback);
  addOptionalValue(args, "--reviewer-retries", options.reviewerRetries);
  addOptionalValue(args, "--mode", options.mode);
  addOptionalValue(args, "--max-iterations", options.maxIterations);
  addOptionalValue(args, "--max-iteration-minutes", options.maxIterationMinutes);
  addOptionalValue(args, "--max-total-minutes", options.maxTotalMinutes);
  addOptionalValue(args, "--base-branch", options.baseBranch);
  addOptionalValue(args, "--base-ref", options.baseRef);
  addOptionalValue(args, "--branch-prefix", options.branchPrefix);
  addOptionalValue(args, "--methodology", options.methodology);
  normalizeBoolFlag(options.autoCommit, "--auto-commit", args);
  normalizeBoolFlag(options.autoPush, "--auto-push", args);
  normalizeBoolFlag(options.autoPr, "--auto-pr", args);
  if (options.autoRebase === false) args.push("--no-auto-rebase");
  normalizeBoolFlag(options.noSonar, "--no-sonar", args);

  const runEnv = {
    ...process.env,
    ...env
  };

  if (options.kjHome) {
    runEnv.KJ_HOME = options.kjHome;
  }

  if (options.sonarToken) {
    runEnv.KJ_SONAR_TOKEN = options.sonarToken;
  }

  const result = await execa("node", args, {
    env: runEnv,
    reject: false,
    timeout: options.timeoutMs ? Number(options.timeoutMs) : undefined
  });

  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    command: `node ${args.join(" ")}`
  };
}

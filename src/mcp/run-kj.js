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
  addOptionalValue(args, "--planner", options.planner);
  addOptionalValue(args, "--refactorer", options.refactorer);
  addOptionalValue(args, "--planner-model", options.plannerModel);
  addOptionalValue(args, "--coder-model", options.coderModel);
  addOptionalValue(args, "--reviewer-model", options.reviewerModel);
  addOptionalValue(args, "--refactorer-model", options.refactorerModel);
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
  normalizeBoolFlag(options.enablePlanner, "--enable-planner", args);
  normalizeBoolFlag(options.enableReviewer, "--enable-reviewer", args);
  normalizeBoolFlag(options.enableRefactorer, "--enable-refactorer", args);
  normalizeBoolFlag(options.enableResearcher, "--enable-researcher", args);
  normalizeBoolFlag(options.enableTester, "--enable-tester", args);
  normalizeBoolFlag(options.enableSecurity, "--enable-security", args);
  normalizeBoolFlag(options.enableImpeccable, "--enable-impeccable", args);
  normalizeBoolFlag(options.enableTriage, "--enable-triage", args);
  normalizeBoolFlag(options.enableDiscover, "--enable-discover", args);
  normalizeBoolFlag(options.enableArchitect, "--enable-architect", args);
  normalizeBoolFlag(options.enableSerena, "--enable-serena", args);
  normalizeBoolFlag(options.autoCommit, "--auto-commit", args);
  normalizeBoolFlag(options.autoPush, "--auto-push", args);
  normalizeBoolFlag(options.autoPr, "--auto-pr", args);
  if (options.autoRebase === false) args.push("--no-auto-rebase");
  addOptionalValue(args, "--task-type", options.taskType);
  normalizeBoolFlag(options.noSonar, "--no-sonar", args);
  if (options.smartModels === true) args.push("--smart-models");
  if (options.smartModels === false) args.push("--no-smart-models");
  addOptionalValue(args, "--checkpoint-interval", options.checkpointInterval);
  addOptionalValue(args, "--pg-task", options.pgTask);
  addOptionalValue(args, "--pg-project", options.pgProject);

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

  const timeout = options.timeoutMs ? Number(options.timeoutMs) : undefined;

  const result = await execa("node", args, {
    env: runEnv,
    reject: false,
    timeout
  });

  const ok = result.exitCode === 0;
  const payload = {
    ok,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  };

  if (result.timedOut) {
    payload.ok = false;
    payload.timedOut = true;
    payload.stderr = `Process timed out after ${Math.round((timeout || 0) / 1000)}s (explicit timeout). Consider using kj_run for interactive checkpoint support instead of subprocess commands.`;
  }

  if (result.killed && !payload.timedOut) {
    payload.ok = false;
    payload.stderr = `Process was killed by signal ${result.signal || "unknown"}. ${result.stderr || ""}`.trim();
  }

  if (!ok && result.stderr && !payload.timedOut) {
    payload.errorSummary = result.stderr.split("\n").filter(Boolean).slice(-3).join(" | ");
  }

  return payload;
}

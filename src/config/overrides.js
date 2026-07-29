/**
 * CLI-flag overrides applied on top of a loaded config.
 *
 * `applyRunOverrides(config, flags)` takes the merged config from the
 * loader plus the CLI flags (also forwarded from MCP tool args) and
 * produces the final config the orchestrator operates on. Overrides are
 * declarative where possible (ROLE_PROVIDER_FLAGS, ROLE_MODEL_FLAGS,
 * PIPELINE_ENABLE_FLAGS, SCALAR_FLAGS, UNDEF_CHECK_FLAGS) and imperative
 * only where the mapping is not 1:1 (methodology, CI, output mode,
 * deprecated flags like `--no-sonar`).
 *
 * Extracted from `src/config.js` in TSK-0332 (Oleada 2 of the v2.7.4
 * audit refactor). Public API: `applyRunOverrides`. The apply* helpers
 * are internal.
 */

import { mergeDeep } from "./loader.js";
import { DEFAULTS } from "./defaults.js";
import { safeParseConfig, formatConfigIssues } from "./schema.js";

const ROLE_PROVIDER_FLAGS = [
  ["planner", "planner"], ["coder", "coder"], ["reviewer", "reviewer"],
  ["refactorer", "refactorer"], ["solomon", "solomon"], ["researcher", "researcher"],
  ["tester", "tester"], ["security", "security"], ["triage", "triage"],
  ["discover", "discover"], ["architect", "architect"]
];

// Role model flags: [flagName, roleName] — truthy check, String coercion
const ROLE_MODEL_FLAGS = [
  ["plannerModel", "planner"], ["coderModel", "coder"], ["reviewerModel", "reviewer"],
  ["refactorerModel", "refactorer"], ["solomonModel", "solomon"], ["discoverModel", "discover"],
  ["architectModel", "architect"]
];

// Pipeline enable flags: [flagName, pipelineKey] — !== undefined check, Boolean coercion
const PIPELINE_ENABLE_FLAGS = [
  ["enablePlanner", "planner"], ["enableRefactorer", "refactorer"],
  ["enableSolomon", "solomon"], ["enableResearcher", "researcher"],
  ["enableTester", "tester"], ["enableSecurity", "security"], ["enableImpeccable", "impeccable"],
  ["enablePerf", "perf"],
  ["enableTriage", "triage"], ["enableDiscover", "discover"],
  ["enableArchitect", "architect"],
  ["enableHuReviewer", "hu_reviewer"]
];

const AUTO_SIMPLIFY_FLAG = "autoSimplify";

// Scalar flags: [flagName, setter] — truthy check.
// Note: max_iterations was previously here but `0` was silently ignored
// (truthy check skipped it). It now lives in UNDEF_CHECK_FLAGS so
// `--max-iterations 0` reaches the schema validator and errors cleanly
// instead of falling through to the default (KJC-TSK-0318).
const SCALAR_FLAGS = [
  ["mode", (out, v) => { out.review_mode = v; }],
  ["maxIterationMinutes", (out, v) => { out.session.max_iteration_minutes = Number(v); }],
  ["maxTotalMinutes", (out, v) => { out.session.max_total_minutes = Number(v); }],
  ["checkpointInterval", (out, v) => { out.session.checkpoint_interval_minutes = Number(v); }],
  ["parallel", (out, v) => { out.session.max_parallel_hus = Number(v); }],
  ["baseBranch", (out, v) => { out.base_branch = v; }],
  ["coderFallback", (out, v) => { out.coder_options.fallback_coder = v; }],
  ["reviewerFallback", (out, v) => { out.reviewer_options.fallback_reviewer = v; }],
  ["taskType", (out, v) => { out.taskType = String(v); }],
  ["branchPrefix", (out, v) => { out.git.branch_prefix = String(v); }]
];

// Boolean/undefined-check flags: [flagName, setter] — !== undefined check.
// These preserve falsy values (false, 0) so --no-rebase correctly sets
// auto_rebase=false and --reviewer-retries 0 correctly disables retries.
const UNDEF_CHECK_FLAGS = [
  ["maxIterations", (out, v) => { out.max_iterations = Number(v); }],
  ["reviewerRetries", (out, v) => { out.reviewer_options.retries = Number(v); }],
  ["autoCommit", (out, v) => { out.git.auto_commit = Boolean(v); }],
  ["autoPush", (out, v) => { out.git.auto_push = Boolean(v); }],
  ["autoPr", (out, v) => { out.git.auto_pr = Boolean(v); }],
  ["autoRebase", (out, v) => { out.git.auto_rebase = Boolean(v); }],
  ["enableSerena", (out, v) => { out.serena.enabled = Boolean(v); }]
];

function applyRoleOverrides(out, flags) {
  // A provider override is always a string (`--security codex`). A bare
  // boolean means the flag belongs to the command itself (`kj audit
  // --security`, KJC-TSK-0695) and must not become a provider.
  for (const [flag, role] of ROLE_PROVIDER_FLAGS) {
    if (typeof flags[flag] === "string" && flags[flag]) out.roles[role].provider = flags[flag];
  }
  // coder/reviewer also update top-level aliases
  if (flags.coder) out.coder = flags.coder;
  if (flags.reviewer) out.reviewer = flags.reviewer;

  for (const [flag, role] of ROLE_MODEL_FLAGS) {
    if (flags[flag]) out.roles[role].model = String(flags[flag]);
  }
  // reviewerModel also updates reviewer_options
  if (flags.reviewerModel) out.reviewer_options.model = String(flags.reviewerModel);
}

function applyPipelineOverrides(out, flags) {
  for (const [flag, key] of PIPELINE_ENABLE_FLAGS) {
    if (flags[flag] !== undefined) out.pipeline[key].enabled = Boolean(flags[flag]);
  }
  if (flags.enableReviewer !== undefined) {
    out.pipeline.reviewer = out.pipeline.reviewer || {};
    out.pipeline.reviewer.enabled = Boolean(flags.enableReviewer);
  }
}

function applyScalarAndBooleanOverrides(out, flags) {
  for (const [flag, setter] of SCALAR_FLAGS) {
    if (flags[flag]) setter(out, flags[flag]);
  }
  for (const [flag, setter] of UNDEF_CHECK_FLAGS) {
    if (flags[flag] !== undefined) setter(out, flags[flag]);
  }
}

function applyMethodologyOverride(out, flags) {
  if (!flags.methodology) return;
  const methodology = String(flags.methodology).toLowerCase();
  out.development.methodology = methodology;
  out.development.require_test_changes = methodology === "tdd";
}

function applyCiOverride(out, flags) {
  out.ci = out.ci || { enabled: false };
  if (flags.enableCi === undefined) return;
  out.ci.enabled = Boolean(flags.enableCi);
  // CI requires git automation (commit + push + PR)
  if (out.ci.enabled) {
    out.git.auto_commit = true;
    out.git.auto_push = true;
    out.git.auto_pr = true;
  }
}

function applyOutputModeOverrides(out, flags) {
  out.output = out.output || {};
  // --verbose explicitly overrides quiet
  if (flags.verbose === true) {
    out.output.quiet = false;
  } else if (flags.quiet === true) {
    out.output.quiet = true;
  }
  // quiet defaults to true (set in DEFAULTS)
}

function applyMiscOverrides(out, flags) {
  if (flags[AUTO_SIMPLIFY_FLAG] !== undefined) out.pipeline.auto_simplify = Boolean(flags[AUTO_SIMPLIFY_FLAG]);
  // `--no-sonar` and `sonarqube.enabled: false` are deprecated since v2.7.4.
  // Sonar is intrinsic to Karajan for code tasks (sw/refactor/add-tests) and
  // skipped for non-code tasks (audit/doc/infra/analysis/no-code) by policy.
  // The flag is still accepted to avoid breaking scripts; it now emits a
  // warning at run start and is otherwise ignored. See preflight-checks.js
  // and flow-runner.js for the actual gate (resolvedPolicies.sonar).
  // --step: per-iteration supervision gate (KJC-TSK-0628).
  if (flags.step === true) out.session.iteration_gate = true;

  if (flags.noSonar || flags.sonar === false) {
    out._deprecated = out._deprecated || {};
    out._deprecated.noSonarFlag = true;
  }
  out.sonarcloud = out.sonarcloud || {};
  if (flags.enableSonarcloud === true) out.sonarcloud.enabled = true;
  if (flags.noSonarcloud === true || flags.sonarcloud === false) out.sonarcloud.enabled = false;

  out.planning_game = out.planning_game || {};
  if (flags.pgTask) out.planning_game.enabled = true;
  if (flags.pgProject) out.planning_game.project_id = flags.pgProject;

  out.model_selection = out.model_selection || { enabled: true, tiers: {}, role_overrides: {} };
  if (flags.smartModels === true) out.model_selection.enabled = true;
  if (flags.smartModels === false || flags.noSmartModels === true) out.model_selection.enabled = false;
}

export function applyRunOverrides(config, flags) {
  const out = mergeDeep(config, {});
  out.coder_options = out.coder_options || {};
  out.reviewer_options = out.reviewer_options || {};
  out.session = out.session || {};
  out.git = out.git || {};
  out.development = out.development || {};
  out.sonarqube = out.sonarqube || {};
  // Precedence: explicit top-level value (including null = opt-out) wins;
  // the legacy session.max_budget_usd location next; the shipped default
  // (KJC-TSK-0621: 5) last. When top-level still carries the default, a
  // session-level value — including an explicit null — takes over.
  if (out.max_budget_usd === undefined) {
    out.max_budget_usd = out.session.max_budget_usd !== undefined ? out.session.max_budget_usd : DEFAULTS.max_budget_usd;
  } else if (out.max_budget_usd === DEFAULTS.max_budget_usd && out.session.max_budget_usd !== undefined) {
    out.max_budget_usd = out.session.max_budget_usd;
  }
  out.budget = mergeDeep(DEFAULTS.budget, out.budget || {});
  out.roles = mergeDeep(DEFAULTS.roles, out.roles || {});
  out.pipeline = mergeDeep(DEFAULTS.pipeline, out.pipeline || {});
  out.serena = out.serena || { enabled: false };

  applyRoleOverrides(out, flags);
  applyPipelineOverrides(out, flags);
  applyScalarAndBooleanOverrides(out, flags);
  applyMethodologyOverride(out, flags);
  applyCiOverride(out, flags);
  applyMiscOverrides(out, flags);
  applyOutputModeOverrides(out, flags);

  // KJC-TSK-0318 — re-run schema validation after overrides so CLI flags
  // that would produce an invalid config (e.g. --max-iterations 0) fail
  // fast with the same clear message loadConfig would have produced.
  const validation = safeParseConfig(out);
  if (!validation.success) {
    throw new Error(`Invalid Karajan config after CLI overrides:\n${formatConfigIssues(validation.issues)}`);
  }

  return out;
}

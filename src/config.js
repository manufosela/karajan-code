import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ensureDir, exists } from "./utils/fs.js";
import { getKarajanHome } from "./utils/paths.js";

const DEFAULTS = {
  coder: "claude",
  reviewer: "codex",
  roles: {
    planner: { provider: null, model: null },
    coder: { provider: null, model: null },
    reviewer: { provider: null, model: null },
    refactorer: { provider: null, model: null },
    solomon: { provider: null, model: null },
    researcher: { provider: null, model: null },
    tester: { provider: null, model: null },
    security: { provider: null, model: null },
    impeccable: { provider: null, model: null },
    triage: { provider: null, model: null },
    discover: { provider: null, model: null },
    architect: { provider: null, model: null },
    hu_reviewer: { provider: null, model: null }
  },
  pipeline: {
    planner: { enabled: false },
    refactorer: { enabled: false },
    solomon: { enabled: true },
    researcher: { enabled: false },
    tester: { enabled: true },
    security: { enabled: true },
    impeccable: { enabled: false },
    triage: { enabled: true },
    discover: { enabled: false },
    architect: { enabled: false },
    hu_reviewer: { enabled: false },
    auto_simplify: true
  },
  review_mode: "standard",
  max_iterations: 5,
  max_budget_usd: null,
  review_rules: "./review-rules.md",
  coder_rules: "./coder-rules.md",
  base_branch: "main",
  coder_options: { model: null, auto_approve: true, fallback_coder: null },
  reviewer_options: {
    output_format: "json",
    require_schema: true,
    model: null,
    deterministic: true,
    retries: 1,
    fallback_reviewer: "codex"
  },
  development: {
    methodology: "tdd",
    require_test_changes: true,
    test_file_patterns: ["/tests/", "/__tests__/", ".test.", ".spec."],
    source_file_extensions: [".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".cs"]
  },
  sonarqube: {
    enabled: true,
    host: "http://localhost:9000",
    external: false,
    container_name: "karajan-sonarqube",
    network: "karajan_sonar_net",
    volumes: {
      data: "karajan_sonar_data",
      logs: "karajan_sonar_logs",
      extensions: "karajan_sonar_extensions"
    },
    timeouts: {
      healthcheck_seconds: 5,
      compose_up_ms: 300000,
      compose_control_ms: 120000,
      logs_ms: 30000,
      scanner_ms: 900000
    },
    token: null,
    project_key: null,
    admin_user: "admin",
    admin_password: null,
    coverage: {
      enabled: false,
      command: null,
      timeout_ms: 300000,
      block_on_failure: true,
      lcov_report_path: null
    },
    quality_gate: true,
    enforcement_profile: "pragmatic",
    gate_block_on: [
      "new_reliability_rating=E",
      "new_security_rating=E",
      "new_maintainability_rating=E",
      "new_coverage<80",
      "new_duplicated_lines_density>5"
    ],
    fail_on: ["BLOCKER", "CRITICAL"],
    ignore_on: ["INFO"],
    max_scan_retries: 3,
    scanner: {
      sources: "src,public,lib",
      exclusions: "**/node_modules/**,**/fake-apps/**,**/scripts/**,**/playground/**,**/dist/**,**/build/**,**/*.min.js",
      test_inclusions: "**/*.test.js,**/*.spec.js,**/tests/**,**/__tests__/**",
      coverage_exclusions: "**/tests/**,**/__tests__/**,**/*.test.js,**/*.spec.js",
      disabled_rules: ["javascript:S1116", "javascript:S3776"]
    }
  },
  sonarcloud: {
    enabled: false,
    organization: null,
    token: null,
    project_key: null,
    host: "https://sonarcloud.io",
    scanner: {
      sources: "src,public,lib",
      exclusions: "**/node_modules/**,**/dist/**,**/build/**,**/*.min.js",
      test_inclusions: "**/*.test.js,**/*.spec.js,**/tests/**,**/__tests__/**"
    }
  },
  hu_board: {
    enabled: false,
    port: 4000,
    auto_start: false
  },
  policies: {},
  serena: { enabled: false },
  planning_game: { enabled: false, project_id: null, codeveloper: null },
  becaria: { enabled: false, review_event: "becaria-review", comment_event: "becaria-comment", comment_prefix: true },
  git: { auto_commit: false, auto_push: false, auto_pr: false, auto_rebase: true, branch_prefix: "feat/" },
  output: { report_dir: "./.reviews", log_level: "info", quiet: true },
  budget: {
    warn_threshold_pct: 80,
    currency: "usd",
    exchange_rate_eur: 0.92
  },
  model_selection: {
    enabled: true,
    tiers: {},
    role_overrides: {}
  },
  session: {
    max_iteration_minutes: 30,
    max_total_minutes: 120,
    max_planner_minutes: 60,
    checkpoint_interval_minutes: 5,
    max_agent_silence_minutes: 20,
    fail_fast_repeats: 2,
    repeat_detection_threshold: 2,
    max_sonar_retries: 3,
    max_reviewer_retries: 3,
    max_tester_retries: 1,
    max_security_retries: 1,
    max_auto_resumes: 2,
    expiry_days: 30
  },
  failFast: {
    repeatThreshold: 2
  },
  retry: {
    max_attempts: 3,
    initial_backoff_ms: 1000,
    max_backoff_ms: 30000,
    backoff_multiplier: 2,
    jitter_factor: 0.1
  },
  guards: {
    output: {
      enabled: true,
      patterns: [],
      protected_files: [],
      on_violation: "block"
    },
    perf: {
      enabled: true,
      patterns: [],
      block_on_warning: false,
      frontend_extensions: []
    },
    intent: {
      enabled: false,
      patterns: [],
      confidence_threshold: 0.85
    }
  }
};

function mergeDeep(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (value && typeof value === "object") {
      output[key] = mergeDeep(base[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function getConfigPath() {
  return path.join(getKarajanHome(), "kj.config.yml");
}

export function getProjectConfigPath(projectDir = process.cwd()) {
  return path.join(projectDir, ".karajan", "kj.config.yml");
}

export async function loadProjectConfig(projectDir = process.cwd()) {
  const projectConfigPath = getProjectConfigPath(projectDir);
  if (!(await exists(projectConfigPath))) {
    return null;
  }
  const raw = await fs.readFile(projectConfigPath, "utf8");
  return yaml.load(raw) || {};
}

async function loadProjectPricingOverrides(projectDir = process.cwd()) {
  const projectConfigPath = path.join(projectDir, ".karajan.yml");
  if (!(await exists(projectConfigPath))) {
    return null;
  }

  const raw = await fs.readFile(projectConfigPath, "utf8");
  const parsed = yaml.load(raw) || {};
  const pricing = parsed?.budget?.pricing;
  if (!pricing || typeof pricing !== "object") {
    return null;
  }

  return pricing;
}

export async function loadConfig(projectDir) {
  const configPath = getConfigPath();
  const projectPricing = await loadProjectPricingOverrides(projectDir);

  // Load global config
  let globalConfig = {};
  const globalExists = await exists(configPath);
  if (globalExists) {
    const raw = await fs.readFile(configPath, "utf8");
    globalConfig = yaml.load(raw) || {};
  }

  // Load project config (.karajan/kj.config.yml)
  const projectConfig = await loadProjectConfig(projectDir);

  // Merge: DEFAULTS < global < project
  let merged = mergeDeep(DEFAULTS, globalConfig);
  if (projectConfig) {
    merged = mergeDeep(merged, projectConfig);
  }

  if (projectPricing) {
    merged.budget = mergeDeep(merged.budget || {}, { pricing: projectPricing });
  }

  return { config: merged, path: configPath, exists: globalExists, hasProjectConfig: !!projectConfig };
}

export async function writeConfig(configPath, config) {
  await ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, yaml.dump(config, { lineWidth: 120 }), "utf8");
}

// Declarative mappings for applyRunOverrides to reduce cognitive complexity.

// Role provider flags: [flagName, roleName] — truthy check
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
  ["enableTriage", "triage"], ["enableDiscover", "discover"],
  ["enableArchitect", "architect"],
  ["enableHuReviewer", "hu_reviewer"]
];

const AUTO_SIMPLIFY_FLAG = "autoSimplify";

// Scalar flags: [flagName, setter] — truthy check
const SCALAR_FLAGS = [
  ["mode", (out, v) => { out.review_mode = v; }],
  ["maxIterations", (out, v) => { out.max_iterations = Number(v); }],
  ["maxIterationMinutes", (out, v) => { out.session.max_iteration_minutes = Number(v); }],
  ["maxTotalMinutes", (out, v) => { out.session.max_total_minutes = Number(v); }],
  ["checkpointInterval", (out, v) => { out.session.checkpoint_interval_minutes = Number(v); }],
  ["baseBranch", (out, v) => { out.base_branch = v; }],
  ["coderFallback", (out, v) => { out.coder_options.fallback_coder = v; }],
  ["reviewerFallback", (out, v) => { out.reviewer_options.fallback_reviewer = v; }],
  ["taskType", (out, v) => { out.taskType = String(v); }],
  ["branchPrefix", (out, v) => { out.git.branch_prefix = String(v); }]
];

// Boolean/undefined-check flags: [flagName, setter] — !== undefined check
const UNDEF_CHECK_FLAGS = [
  ["reviewerRetries", (out, v) => { out.reviewer_options.retries = Number(v); }],
  ["autoCommit", (out, v) => { out.git.auto_commit = Boolean(v); }],
  ["autoPush", (out, v) => { out.git.auto_push = Boolean(v); }],
  ["autoPr", (out, v) => { out.git.auto_pr = Boolean(v); }],
  ["autoRebase", (out, v) => { out.git.auto_rebase = Boolean(v); }],
  ["enableSerena", (out, v) => { out.serena.enabled = Boolean(v); }]
];

function applyRoleOverrides(out, flags) {
  for (const [flag, role] of ROLE_PROVIDER_FLAGS) {
    if (flags[flag]) out.roles[role].provider = flags[flag];
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

function applyBecariaOverride(out, flags) {
  out.becaria = out.becaria || { enabled: false };
  if (flags.enableBecaria === undefined) return;
  out.becaria.enabled = Boolean(flags.enableBecaria);
  // BecarIA requires git automation (commit + push + PR)
  if (out.becaria.enabled) {
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
  if (flags.noSonar || flags.sonar === false) out.sonarqube.enabled = false;
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
  if (out.max_budget_usd === undefined || out.max_budget_usd === null) {
    out.max_budget_usd = out.session.max_budget_usd ?? null;
  }
  out.budget = mergeDeep(DEFAULTS.budget, out.budget || {});
  out.roles = mergeDeep(DEFAULTS.roles, out.roles || {});
  out.pipeline = mergeDeep(DEFAULTS.pipeline, out.pipeline || {});
  out.serena = out.serena || { enabled: false };

  applyRoleOverrides(out, flags);
  applyPipelineOverrides(out, flags);
  applyScalarAndBooleanOverrides(out, flags);
  applyMethodologyOverride(out, flags);
  applyBecariaOverride(out, flags);
  applyMiscOverrides(out, flags);
  applyOutputModeOverrides(out, flags);

  return out;
}

/**
 * Check if a model string is compatible with an agent provider.
 * Only returns false when the model clearly belongs to a DIFFERENT provider.
 * Returns true if we can't determine or if the model is ambiguous.
 */
const AGENT_MODEL_SIGNATURES = {
  claude: ["claude", "sonnet", "opus", "haiku"],
  codex: ["o4-", "o3-", "gpt-", "codex"],
  gemini: ["gemini", "flash-"]
};

export function isModelCompatible(agent, model) {
  if (!model || !agent) return true;
  const lower = model.toLowerCase();

  // Check if model clearly belongs to a different provider
  for (const [provider, signatures] of Object.entries(AGENT_MODEL_SIGNATURES)) {
    if (provider === agent) continue;
    if (signatures.some(s => lower.includes(s))) {
      // Model belongs to a different provider — incompatible
      return false;
    }
  }

  // Model doesn't clearly belong to any other provider — allow it
  return true;
}

export function resolveRole(config, role) {
  const roles = config?.roles || {};
  const roleConfig = roles[role] || {};
  const legacyCoder = config?.coder || null;
  const legacyReviewer = config?.reviewer || null;

  let provider = roleConfig.provider ?? null;
  if (!provider && role === "coder") provider = legacyCoder;
  if (!provider && role === "reviewer") provider = legacyReviewer;
  if (!provider && (role === "planner" || role === "refactorer" || role === "solomon" || role === "researcher" || role === "tester" || role === "security" || role === "impeccable" || role === "triage" || role === "discover" || role === "architect" || role === "audit" || role === "hu_reviewer" || role === "hu-reviewer")) {
    provider = roles.coder?.provider || legacyCoder;
  }

  let model = roleConfig.model ?? null;
  let modelIsInherited = false;
  if (!model && role === "coder") model = config?.coder_options?.model ?? null;
  if (!model && role === "reviewer") model = config?.reviewer_options?.model ?? null;
  if (!model && (role === "planner" || role === "refactorer" || role === "solomon" || role === "researcher" || role === "tester" || role === "security" || role === "impeccable" || role === "triage" || role === "discover" || role === "architect" || role === "hu_reviewer" || role === "hu-reviewer")) {
    model = config?.coder_options?.model ?? null;
    modelIsInherited = !!model;
  }

  // Drop inherited model if incompatible with the resolved provider
  if (modelIsInherited && provider && model && !isModelCompatible(provider, model)) {
    model = null;
  }

  return { provider, model };
}

// Pipeline roles checked when commandName is "run": [pipelineKey, roleName]
const RUN_PIPELINE_ROLES = [
  ["reviewer", "reviewer"], ["triage", "triage"], ["planner", "planner"],
  ["refactorer", "refactorer"], ["researcher", "researcher"],
  ["tester", "tester"], ["security", "security"], ["impeccable", "impeccable"]
];

// Direct command-to-role mapping for non-"run" commands
const COMMAND_ROLE_MAP = {
  discover: ["discover"],
  plan: ["planner"],
  code: ["coder"],
  review: ["reviewer"]
};

function requiredRolesFor(commandName, config) {
  if (commandName !== "run") {
    return COMMAND_ROLE_MAP[commandName] || [];
  }
  const required = ["coder"];
  for (const [pipelineKey, roleName] of RUN_PIPELINE_ROLES) {
    const pipelineEntry = config?.pipeline?.[pipelineKey];
    // reviewer defaults to enabled (only excluded if explicitly false)
    const isEnabled = pipelineKey === "reviewer"
      ? pipelineEntry?.enabled !== false
      : Boolean(pipelineEntry?.enabled);
    if (isEnabled) required.push(roleName);
  }
  return required;
}

export function validateConfig(config, commandName = "run") {
  const errors = [];
  if (!new Set(["paranoid", "strict", "standard", "relaxed", "custom"]).has(config.review_mode)) {
    errors.push(`Invalid review_mode: ${config.review_mode}`);
  }
  if (!new Set(["tdd", "standard"]).has(config.development?.methodology)) {
    errors.push(`Invalid development.methodology: ${config.development?.methodology}`);
  }

  const requiredRoles = requiredRolesFor(commandName, config);
  for (const role of requiredRoles) {
    const { provider } = resolveRole(config, role);
    if (!provider) {
      errors.push(
        `Missing provider for required role '${role}'. Set 'roles.${role}.provider' or pass '--${role} <name>'`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  return config;
}

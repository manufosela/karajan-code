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
    triage: { provider: null, model: null },
    discover: { provider: null, model: null }
  },
  pipeline: {
    planner: { enabled: false },
    refactorer: { enabled: false },
    solomon: { enabled: true },
    researcher: { enabled: false },
    tester: { enabled: true },
    security: { enabled: true },
    triage: { enabled: true },
    discover: { enabled: false }
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
  policies: {},
  serena: { enabled: false },
  planning_game: { enabled: false, project_id: null, codeveloper: null },
  becaria: { enabled: false, review_event: "becaria-review", comment_event: "becaria-comment", comment_prefix: true },
  git: { auto_commit: false, auto_push: false, auto_pr: false, auto_rebase: true, branch_prefix: "feat/" },
  output: { report_dir: "./.reviews", log_level: "info" },
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

  if (flags.planner) out.roles.planner.provider = flags.planner;
  if (flags.coder) out.coder = flags.coder;
  if (flags.coder) out.roles.coder.provider = flags.coder;
  if (flags.reviewer) out.reviewer = flags.reviewer;
  if (flags.reviewer) out.roles.reviewer.provider = flags.reviewer;
  if (flags.refactorer) out.roles.refactorer.provider = flags.refactorer;
  if (flags.solomon) out.roles.solomon.provider = flags.solomon;
  if (flags.researcher) out.roles.researcher.provider = flags.researcher;
  if (flags.tester) out.roles.tester.provider = flags.tester;
  if (flags.security) out.roles.security.provider = flags.security;
  if (flags.triage) out.roles.triage.provider = flags.triage;
  if (flags.discover) out.roles.discover.provider = flags.discover;
  if (flags.discoverModel) out.roles.discover.model = String(flags.discoverModel);
  if (flags.enableDiscover !== undefined) out.pipeline.discover.enabled = Boolean(flags.enableDiscover);
  if (flags.plannerModel) out.roles.planner.model = String(flags.plannerModel);
  if (flags.coderModel) {
    out.roles.coder.model = String(flags.coderModel);
  }
  if (flags.reviewerModel) {
    out.roles.reviewer.model = String(flags.reviewerModel);
    out.reviewer_options.model = String(flags.reviewerModel);
  }
  if (flags.refactorerModel) out.roles.refactorer.model = String(flags.refactorerModel);
  if (flags.solomonModel) out.roles.solomon.model = String(flags.solomonModel);
  if (flags.enablePlanner !== undefined) out.pipeline.planner.enabled = Boolean(flags.enablePlanner);
  if (flags.enableRefactorer !== undefined) out.pipeline.refactorer.enabled = Boolean(flags.enableRefactorer);
  if (flags.enableSolomon !== undefined) out.pipeline.solomon.enabled = Boolean(flags.enableSolomon);
  if (flags.enableResearcher !== undefined) out.pipeline.researcher.enabled = Boolean(flags.enableResearcher);
  if (flags.enableTester !== undefined) out.pipeline.tester.enabled = Boolean(flags.enableTester);
  if (flags.enableSecurity !== undefined) out.pipeline.security.enabled = Boolean(flags.enableSecurity);
  if (flags.enableReviewer !== undefined) {
    out.pipeline.reviewer = out.pipeline.reviewer || {};
    out.pipeline.reviewer.enabled = Boolean(flags.enableReviewer);
  }
  if (flags.enableTriage !== undefined) out.pipeline.triage.enabled = Boolean(flags.enableTriage);
  if (flags.mode) out.review_mode = flags.mode;
  if (flags.maxIterations) out.max_iterations = Number(flags.maxIterations);
  if (flags.maxIterationMinutes) out.session.max_iteration_minutes = Number(flags.maxIterationMinutes);
  if (flags.maxTotalMinutes) out.session.max_total_minutes = Number(flags.maxTotalMinutes);
  if (flags.checkpointInterval) out.session.checkpoint_interval_minutes = Number(flags.checkpointInterval);
  if (flags.baseBranch) out.base_branch = flags.baseBranch;
  if (flags.coderFallback) out.coder_options.fallback_coder = flags.coderFallback;
  if (flags.reviewerFallback) out.reviewer_options.fallback_reviewer = flags.reviewerFallback;
  if (flags.reviewerRetries !== undefined) out.reviewer_options.retries = Number(flags.reviewerRetries);
  if (flags.autoCommit !== undefined) out.git.auto_commit = Boolean(flags.autoCommit);
  if (flags.autoPush !== undefined) out.git.auto_push = Boolean(flags.autoPush);
  if (flags.autoPr !== undefined) out.git.auto_pr = Boolean(flags.autoPr);
  if (flags.autoRebase !== undefined) out.git.auto_rebase = Boolean(flags.autoRebase);
  if (flags.branchPrefix) out.git.branch_prefix = String(flags.branchPrefix);
  if (flags.methodology) {
    const methodology = String(flags.methodology).toLowerCase();
    out.development = out.development || {};
    out.development.methodology = methodology;
    out.development.require_test_changes = methodology === "tdd";
  }
  if (flags.taskType) out.taskType = String(flags.taskType);
  if (flags.noSonar || flags.sonar === false) out.sonarqube.enabled = false;
  out.serena = out.serena || { enabled: false };
  if (flags.enableSerena !== undefined) out.serena.enabled = Boolean(flags.enableSerena);
  out.becaria = out.becaria || { enabled: false };
  if (flags.enableBecaria !== undefined) {
    out.becaria.enabled = Boolean(flags.enableBecaria);
    // BecarIA requires git automation (commit + push + PR)
    if (out.becaria.enabled) {
      out.git.auto_commit = true;
      out.git.auto_push = true;
      out.git.auto_pr = true;
    }
  }
  out.planning_game = out.planning_game || {};
  if (flags.pgTask) out.planning_game.enabled = true;
  if (flags.pgProject) out.planning_game.project_id = flags.pgProject;
  out.model_selection = out.model_selection || { enabled: true, tiers: {}, role_overrides: {} };
  if (flags.smartModels === true) out.model_selection.enabled = true;
  if (flags.smartModels === false || flags.noSmartModels === true) out.model_selection.enabled = false;
  return out;
}

export function resolveRole(config, role) {
  const roles = config?.roles || {};
  const roleConfig = roles[role] || {};
  const legacyCoder = config?.coder || null;
  const legacyReviewer = config?.reviewer || null;

  let provider = roleConfig.provider ?? null;
  if (!provider && role === "coder") provider = legacyCoder;
  if (!provider && role === "reviewer") provider = legacyReviewer;
  if (!provider && (role === "planner" || role === "refactorer" || role === "solomon" || role === "researcher" || role === "tester" || role === "security" || role === "triage" || role === "discover")) {
    provider = roles.coder?.provider || legacyCoder;
  }

  let model = roleConfig.model ?? null;
  if (!model && role === "coder") model = config?.coder_options?.model ?? null;
  if (!model && role === "reviewer") model = config?.reviewer_options?.model ?? null;
  if (!model && (role === "planner" || role === "refactorer" || role === "solomon" || role === "researcher" || role === "tester" || role === "security" || role === "triage" || role === "discover")) {
    model = config?.coder_options?.model ?? null;
  }

  return { provider, model };
}

function requiredRolesFor(commandName, config) {
  if (commandName === "run") {
    const required = ["coder"];
    if (config?.pipeline?.reviewer?.enabled !== false) required.push("reviewer");
    if (config?.pipeline?.triage?.enabled) required.push("triage");
    if (config?.pipeline?.planner?.enabled) required.push("planner");
    if (config?.pipeline?.refactorer?.enabled) required.push("refactorer");
    if (config?.pipeline?.researcher?.enabled) required.push("researcher");
    if (config?.pipeline?.tester?.enabled) required.push("tester");
    if (config?.pipeline?.security?.enabled) required.push("security");
    return required;
  }
  if (commandName === "plan") return ["planner"];
  if (commandName === "code") return ["coder"];
  if (commandName === "review") return ["reviewer"];
  return [];
}

export function validateConfig(config, commandName = "run") {
  const errors = [];
  if (!["paranoid", "strict", "standard", "relaxed", "custom"].includes(config.review_mode)) {
    errors.push(`Invalid review_mode: ${config.review_mode}`);
  }
  if (!["tdd", "standard"].includes(config.development?.methodology)) {
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

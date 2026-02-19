import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ensureDir, exists } from "./utils/fs.js";
import { getKarajanHome } from "./utils/paths.js";

const DEFAULTS = {
  coder: "claude",
  reviewer: "codex",
  review_mode: "standard",
  max_iterations: 5,
  review_rules: "./review-rules.md",
  base_branch: "main",
  coder_options: { model: null, auto_approve: true },
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
    token: null,
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
  git: { auto_commit: false, auto_push: false, auto_pr: false, auto_rebase: true, branch_prefix: "feat/" },
  output: { report_dir: "./.reviews", log_level: "info" },
  session: { max_iteration_minutes: 15, max_total_minutes: 120, max_budget_usd: null, fail_fast_repeats: 2 }
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

export async function loadConfig() {
  const configPath = getConfigPath();
  if (!(await exists(configPath))) {
    return { config: DEFAULTS, path: configPath, exists: false };
  }

  const raw = await fs.readFile(configPath, "utf8");
  const parsed = yaml.load(raw) || {};
  return { config: mergeDeep(DEFAULTS, parsed), path: configPath, exists: true };
}

export async function writeConfig(configPath, config) {
  await ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, yaml.dump(config, { lineWidth: 120 }), "utf8");
}

export function applyRunOverrides(config, flags) {
  const out = mergeDeep(config, {});
  if (flags.coder) out.coder = flags.coder;
  if (flags.reviewer) out.reviewer = flags.reviewer;
  if (flags.mode) out.review_mode = flags.mode;
  if (flags.maxIterations) out.max_iterations = Number(flags.maxIterations);
  if (flags.maxIterationMinutes) out.session.max_iteration_minutes = Number(flags.maxIterationMinutes);
  if (flags.maxTotalMinutes) out.session.max_total_minutes = Number(flags.maxTotalMinutes);
  if (flags.baseBranch) out.base_branch = flags.baseBranch;
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
  if (flags.noSonar || flags.sonar === false) out.sonarqube.enabled = false;
  return out;
}

export function validateConfig(config, commandName = "run") {
  const errors = [];
  if (!["paranoid", "strict", "standard", "relaxed", "custom"].includes(config.review_mode)) {
    errors.push(`Invalid review_mode: ${config.review_mode}`);
  }
  if (!["tdd", "standard"].includes(config.development?.methodology)) {
    errors.push(`Invalid development.methodology: ${config.development?.methodology}`);
  }

  if (commandName === "run") {
    if (!config.coder) errors.push("Missing coder");
    if (!config.reviewer) errors.push("Missing reviewer");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  return config;
}

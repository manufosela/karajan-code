import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ensureDir, exists } from "./utils/fs.js";

const DEFAULTS = {
  coder: "codex",
  reviewer: "claude",
  review_mode: "standard",
  max_iterations: 5,
  review_rules: "./review-rules.md",
  base_branch: "main",
  coder_options: { model: null, auto_approve: true },
  reviewer_options: { output_format: "json", require_schema: true, model: null },
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
    max_scan_retries: 3
  },
  git: { auto_commit: false, auto_push: false, auto_pr: false, branch_prefix: "feat/" },
  output: { report_dir: "./.reviews", log_level: "info" },
  session: { max_iteration_minutes: 20, max_total_minutes: 120, max_budget_usd: null, fail_fast_repeats: 2 }
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

export function getConfigPath(cwd = process.cwd()) {
  return path.join(cwd, "kj.config.yml");
}

export async function loadConfig(cwd = process.cwd()) {
  const configPath = getConfigPath(cwd);
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
  if (flags.baseBranch) out.base_branch = flags.baseBranch;
  if (flags.noSonar) out.sonarqube.enabled = false;
  return out;
}

export function validateConfig(config, commandName = "run") {
  const errors = [];
  if (!["paranoid", "strict", "standard", "relaxed", "custom"].includes(config.review_mode)) {
    errors.push(`Invalid review_mode: ${config.review_mode}`);
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

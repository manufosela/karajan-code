/**
 * Project bootstrap — mandatory prerequisite gate.
 *
 * Before any KJ tool that executes agents (kj_run, kj_code, kj_review, etc.),
 * this module validates that ALL environment prerequisites are met.
 *
 * Philosophy: NEVER degrade gracefully. If something is missing, STOP and
 * tell the user exactly what to fix. No silent fallbacks, no auto-disabling.
 *
 * Results are cached in `.kj-ready.json` per project (TTL-based) so that
 * slow checks (SonarQube reachability, agent detection) don't repeat on
 * every invocation.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureGitRepo } from "./utils/git.js";
import { runCommand } from "./utils/process.js";
import { checkBinary } from "./utils/agent-detect.js";
import { exists } from "./utils/fs.js";
import { getConfigPath, resolveRole } from "./config.js";
import { isSonarReachable, sonarUp } from "./sonar/manager.js";
import { withDocLink } from "./utils/doc-links.js";

const BOOTSTRAP_VERSION = 1;
const BOOTSTRAP_TTL_HOURS = 24;
const BOOTSTRAP_FILENAME = ".kj-ready.json";

function getPackageVersion() {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

// ── Individual checks ────────────────────────────────────────────────

async function checkGitRepo() {
  let ok = false;
  try {
    ok = await ensureGitRepo();
  } catch { /* git may not be installed */
    ok = false;
  }
  return {
    name: "gitRepo",
    ok,
    detail: ok ? "Inside a git repository" : "Not a git repository",
    fix: "Run 'git init' in your project directory."
  };
}

async function checkGitRemote() {
  try {
    const res = await runCommand("git", ["remote", "get-url", "origin"]);
    if (res.exitCode === 0 && res.stdout.trim()) {
      return { name: "gitRemote", ok: true, detail: res.stdout.trim(), fix: null };
    }
  } catch { /* fall through */ }
  return {
    name: "gitRemote",
    ok: false,
    detail: "origin remote not configured",
    fix: "Run 'git remote add origin <your-repo-url>'."
  };
}

async function checkConfigExists() {
  const configPath = getConfigPath();
  const configOk = await exists(configPath);
  return {
    name: "config",
    ok: configOk,
    detail: configOk ? configPath : "Config file not found",
    fix: configOk ? null : "Run 'kj_init' to create your Karajan config file."
  };
}

async function checkCoreBinaries() {
  const missing = [];
  for (const bin of ["node", "npm", "git"]) {
    const result = await checkBinary(bin);
    if (!result.ok) {
      missing.push(bin);
    }
  }
  if (missing.length > 0) {
    return {
      name: "coreBinaries",
      ok: false,
      detail: `Missing: ${missing.join(", ")}`,
      fix: `Install missing binaries: ${missing.join(", ")}.`
    };
  }
  return { name: "coreBinaries", ok: true, detail: "node, npm, git available", fix: null };
}

async function checkConfiguredAgents(config) {
  const { provider } = resolveRole(config, "coder");
  if (!provider) {
    return {
      name: "agents",
      ok: false,
      detail: "No coder provider configured",
      fix: "Run 'kj_init' or set a coder provider in kj.config.yml."
    };
  }
  const result = await checkBinary(provider);
  if (!result.ok) {
    return {
      name: "agents",
      ok: false,
      detail: `Coder agent "${provider}" not found`,
      fix: `Install "${provider}" CLI. Run 'kj_doctor' for installation instructions.`
    };
  }
  return { name: "agents", ok: true, detail: `coder: ${provider}`, fix: null };
}

async function checkSonarQubeReady(config) {
  if (config.sonarqube?.enabled === false) {
    return { name: "sonarqube", ok: true, detail: "Disabled in config", fix: null };
  }

  const host = config.sonarqube?.host || "http://localhost:9000";

  // First attempt
  let reachable = await isSonarReachable(host);
  if (reachable) {
    return { name: "sonarqube", ok: true, detail: `Reachable at ${host}`, fix: null };
  }

  // Auto-remediation: start and wait up to 60s for SonarQube to be ready
  try {
    await sonarUp(host);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      reachable = await isSonarReachable(host);
      if (reachable) {
        return { name: "sonarqube", ok: true, detail: `Started and reachable at ${host}`, fix: null };
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  } catch { /* fall through */ }

  return {
    name: "sonarqube",
    ok: false,
    detail: `Not reachable at ${host}`,
    fix: `Start SonarQube: 'docker start karajan-sonarqube', or disable it: set sonarqube.enabled: false in kj.config.yml, or pass --no-sonar.`
  };
}

// ── Bootstrap file management ────────────────────────────────────────

function bootstrapPath(projectDir) {
  return path.join(projectDir, BOOTSTRAP_FILENAME);
}

async function readBootstrapFile(projectDir) {
  try {
    const raw = await fs.readFile(bootstrapPath(projectDir), "utf8");
    return JSON.parse(raw);
  } catch { /* bootstrap file may not exist or contain invalid JSON */
    return null;
  }
}

function isBootstrapValid(bootstrap, projectDir) {
  if (!bootstrap || bootstrap.version !== BOOTSTRAP_VERSION) return false;
  if (bootstrap.karajanVersion !== getPackageVersion()) return false;
  if (bootstrap.projectDir !== projectDir) return false;
  const age = Date.now() - new Date(bootstrap.createdAt).getTime();
  if (age > BOOTSTRAP_TTL_HOURS * 3600 * 1000) return false;
  return true;
}

async function writeBootstrapFile(projectDir, checks) {
  const data = {
    version: BOOTSTRAP_VERSION,
    karajanVersion: getPackageVersion(),
    createdAt: new Date().toISOString(),
    projectDir,
    checks: Object.fromEntries(checks.map(c => [c.name, { ok: c.ok, detail: c.detail }]))
  };
  await fs.writeFile(bootstrapPath(projectDir), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function formatBootstrapFailure(failures) {
  const lines = failures.map(f =>
    `  FAIL  ${f.name}: ${f.detail}\n        Fix: ${f.fix}`
  );
  return withDocLink([
    "BOOTSTRAP FAILED — Environment not ready for Karajan Code.\n",
    "The following prerequisite(s) are not met:\n",
    ...lines,
    "",
    "Run 'kj_doctor' for a complete environment diagnostic.",
    "Do NOT work around these issues — fix them properly."
  ].join("\n"), "bootstrap_failed");
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Ensure the project environment is ready for KJ execution.
 * Reads cached `.kj-ready.json` if valid; otherwise runs all checks.
 * Throws Error with actionable message if any prerequisite fails.
 */
export async function ensureBootstrap(projectDir, config) {
  const cached = await readBootstrapFile(projectDir);
  if (isBootstrapValid(cached, projectDir)) {
    return; // Environment already validated
  }

  const checks = await Promise.all([
    checkGitRepo(),
    checkGitRemote(),
    checkConfigExists(),
    checkCoreBinaries(),
    checkConfiguredAgents(config),
    checkSonarQubeReady(config)
  ]);

  const failures = checks.filter(c => !c.ok);
  if (failures.length > 0) {
    throw new Error(formatBootstrapFailure(failures));
  }

  await writeBootstrapFile(projectDir, checks);
}

/**
 * Delete `.kj-ready.json` to force re-validation on next run.
 */
export async function invalidateBootstrap(projectDir) {
  try {
    await fs.unlink(bootstrapPath(projectDir));
  } catch { /* file may not exist */ }
}

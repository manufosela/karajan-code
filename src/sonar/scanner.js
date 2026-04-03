import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/process.js";
import { sonarUp } from "./manager.js";
import { resolveSonarProjectKey } from "./project-key.js";
import {
  resolveSonarHost,
  resolveSonarToken as resolveToken,
  resolveSonarCredentials,
} from "./config-resolver.js";

export function buildScannerOpts(projectKey, scanner = {}) {
  const opts = [`-Dsonar.projectKey=${projectKey}`];
  if (scanner.sources) opts.push(`-Dsonar.sources=${scanner.sources}`);
  if (scanner.exclusions) opts.push(`-Dsonar.exclusions=${scanner.exclusions}`);
  if (scanner.test_inclusions) opts.push(`-Dsonar.test.inclusions=${scanner.test_inclusions}`);
  if (scanner.coverage_exclusions) opts.push(`-Dsonar.coverage.exclusions=${scanner.coverage_exclusions}`);
  if (scanner.javascript_lcov_report_paths) {
    opts.push(`-Dsonar.javascript.lcov.reportPaths=${scanner.javascript_lcov_report_paths}`);
  }
  const rules = scanner.disabled_rules || [];
  rules.forEach((rule, i) => {
    opts.push(
      `-Dsonar.issue.ignore.multicriteria=e${i + 1}`,
      `-Dsonar.issue.ignore.multicriteria.e${i + 1}.ruleKey=${rule}`,
      `-Dsonar.issue.ignore.multicriteria.e${i + 1}.resourceKey=**/*`
    );
  });
  return opts.join(" ");
}

function normalizeScannerConfig(scanner = {}) {
  const out = { ...scanner };
  if (typeof out.sources === "string" && out.sources.trim()) {
    const existing = out.sources
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((entry) => fs.existsSync(entry));

    if (existing.length > 0) {
      out.sources = existing.join(",");
    }
  }
  return out;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch { /* invalid JSON */
    return null;
  }
}

async function validateAdminCredentials(host, user, password) {
  const res = await runCommand("curl", [
    "-sS",
    "-u",
    `${user}:${password}`,
    `${host}/api/authentication/validate`
  ]);
  if (res.exitCode !== 0) return false;
  const parsed = parseJsonSafe(res.stdout);
  return Boolean(parsed?.valid);
}

async function generateUserToken(host, user, password) {
  const tokenName = `karajan-${Date.now()}`;
  const res = await runCommand("curl", [
    "-sS",
    "-u",
    `${user}:${password}`,
    "-X",
    "POST",
    "--data-urlencode",
    `name=${tokenName}`,
    `${host}/api/user_tokens/generate`
  ]);
  if (res.exitCode !== 0) return null;
  const parsed = parseJsonSafe(res.stdout);
  return parsed?.token || null;
}

function coverageConfig(config) {
  return config?.sonarqube?.coverage || {};
}

function checkLcovExists(lcovPath, blockOnFailure, stdout = "") {
  if (!lcovPath) return { ok: true, scannerPatch: {} };
  if (fs.existsSync(lcovPath)) {
    return { ok: true, scannerPatch: { javascript_lcov_report_paths: lcovPath } };
  }
  if (blockOnFailure) {
    return { ok: false, exitCode: 1, stdout, stderr: `Configured lcov report path does not exist: ${lcovPath}` };
  }
  return { ok: true, scannerPatch: {} };
}

function handleCoverageNoCommand(lcovPath, blockOnFailure) {
  if (!lcovPath) {
    return {
      ok: false, exitCode: 1, stdout: "",
      stderr: "Sonar coverage is enabled but neither coverage.command nor coverage.lcov_report_path is configured."
    };
  }
  return checkLcovExists(lcovPath, blockOnFailure);
}

async function maybeRunCoverage(config) {
  const coverage = coverageConfig(config);
  if (!coverage.enabled) return { ok: true, scannerPatch: {} };

  const lcovPath = String(coverage.lcov_report_path || "").trim();
  const blockOnFailure = coverage.block_on_failure !== false;

  if (!String(coverage.command || "").trim()) {
    return handleCoverageNoCommand(lcovPath, blockOnFailure);
  }

  const command = String(coverage.command || "").trim();
  const timeout = Number(coverage.timeout_ms) > 0 ? Number(coverage.timeout_ms) : 5 * 60 * 1000;
  const run = await runCommand("bash", ["-lc", command], { timeout });

  if (run.exitCode !== 0) {
    if (blockOnFailure) {
      return { ok: false, exitCode: run.exitCode, stdout: run.stdout || "", stderr: run.stderr || "Coverage command failed" };
    }
    return { ok: true, scannerPatch: {} };
  }

  return checkLcovExists(lcovPath, blockOnFailure, run.stdout || "");
}

async function resolveSonarTokenWithFallback(config, apiHost) {
  const explicitToken = resolveToken(config);
  if (explicitToken) return explicitToken;

  const { user: adminUser, passwords } = await resolveSonarCredentials(config);
  if (!adminUser || passwords.length === 0) return null;

  for (const password of passwords) {
    const valid = await validateAdminCredentials(apiHost, adminUser, password);
    if (!valid) continue;
    const token = await generateUserToken(apiHost, adminUser, password);
    if (token) return token;
  }

  return null;
}

async function ensureSonarProjectProperties(cwd = process.cwd()) {
  const propsPath = path.join(cwd, "sonar-project.properties");
  try {
    await fsPromises.access(propsPath);
    return; // already exists
  } catch {
    // Auto-generate based on project structure
    let pkg = {};
    try {
      const raw = await fsPromises.readFile(path.join(cwd, "package.json"), "utf8");
      pkg = JSON.parse(raw);
    } catch {
      // no package.json or invalid JSON — use defaults
    }
    const projectKey = (pkg.name || path.basename(cwd)).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const props = [
      `sonar.projectKey=${projectKey}`,
      `sonar.projectName=${pkg.name || path.basename(cwd)}`,
      `sonar.sources=src`,
      `sonar.tests=tests`,
      `sonar.javascript.lcov.reportPaths=coverage/lcov.info`,
      `sonar.exclusions=**/node_modules/**,**/dist/**,**/build/**,**/coverage/**`,
    ].join("\n");
    await fsPromises.writeFile(propsPath, props + "\n", "utf8");
  }
}

export async function runSonarScan(config, projectKey = null) {
  let effectiveProjectKey;
  try {
    effectiveProjectKey = await resolveSonarProjectKey(config, { projectKey });
  } catch (error) {
    return {
      ok: false,
      projectKey: null,
      stdout: "",
      stderr: error?.message || String(error),
      exitCode: 1
    };
  }
  const sonarConfig = config?.sonarqube || {};
  const rawHost = sonarConfig.host || "http://localhost:9000";
  const isExternalSonar = sonarConfig.external === true;
  const scannerTimeout = Number(sonarConfig?.timeouts?.scanner_ms) > 0
    ? Number(sonarConfig.timeouts.scanner_ms)
    : 15 * 60 * 1000;
  const sonarNetwork = sonarConfig.network || "karajan_sonar_net";
  const apiHost = resolveSonarHost(rawHost);
  const isLocalHost = /localhost|127\.0\.0\.1/.test(rawHost);
  const host = isLocalHost ? rawHost.replaceAll(/localhost|127\.0\.0\.1/g, "host.docker.internal") : rawHost;

  const start = await sonarUp(rawHost);
  if (start.exitCode !== 0) {
    return {
      ok: false,
      stdout: start.stdout || "",
      stderr: start.stderr || "Failed to start SonarQube service",
      exitCode: start.exitCode
    };
  }
  await ensureSonarProjectProperties();
  const token = await resolveSonarTokenWithFallback(config, apiHost);
  if (!token) {
    return {
      ok: false,
      stdout: "",
      stderr:
        "Unable to resolve Sonar token. Fix: (1) run 'kj init' to configure it, (2) set KJ_SONAR_TOKEN env var, or (3) add sonarqube.token to ~/.karajan/kj.config.yml.",
      exitCode: 1
    };
  }
  process.env.KJ_SONAR_TOKEN = token;
  const coverage = await maybeRunCoverage(config);
  if (!coverage.ok) {
    return {
      ok: false,
      stdout: coverage.stdout || "",
      stderr: coverage.stderr || "Failed to generate coverage report for SonarQube",
      exitCode: coverage.exitCode || 1
    };
  }
  const scannerConfig = normalizeScannerConfig({
    ...sonarConfig.scanner,
    ...coverage.scannerPatch
  });

  const args = [
    "run",
    "--rm",
    "-v",
    `${process.cwd()}:/usr/src`,
    ...(isLocalHost ? ["--add-host", "host.docker.internal:host-gateway"] : []),
    ...(isLocalHost || isExternalSonar ? [] : ["--network", sonarNetwork]),
    "-e", "SONAR_HOST_URL",
    "-e", "SONAR_TOKEN",
    "-e", "SONAR_SCANNER_OPTS",
    "sonarsource/sonar-scanner-cli"
  ];

  // Pass secrets via process env, not CLI args — invisible in `ps aux`
  const env = {
    ...process.env,
    SONAR_HOST_URL: host,
    SONAR_TOKEN: token || "",
    SONAR_SCANNER_OPTS: buildScannerOpts(effectiveProjectKey, scannerConfig)
  };

  const result = await runCommand("docker", args, { timeout: scannerTimeout, env });
  return {
    ok: result.exitCode === 0,
    projectKey: effectiveProjectKey,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

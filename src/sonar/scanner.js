import fs from "node:fs";
import { runCommand } from "../utils/process.js";
import { sonarUp } from "./manager.js";

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
    opts.push(`-Dsonar.issue.ignore.multicriteria=e${i + 1}`);
    opts.push(`-Dsonar.issue.ignore.multicriteria.e${i + 1}.ruleKey=${rule}`);
    opts.push(`-Dsonar.issue.ignore.multicriteria.e${i + 1}.resourceKey=**/*`);
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
  } catch {
    return null;
  }
}

function normalizeApiHost(rawHost) {
  return String(rawHost || "http://localhost:9000").replace(/host\.docker\.internal/g, "localhost");
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

async function ensureCoverageReport() {
  const result = await runCommand("npm", [
    "test",
    "--",
    "--coverage.enabled",
    "true",
    "--coverage.reporter=lcov",
    "--coverage.reporter=text-summary"
  ]);
  return result;
}

async function resolveSonarToken(config, apiHost) {
  const explicitToken = process.env.KJ_SONAR_TOKEN || process.env.SONAR_TOKEN || config.sonarqube.token;
  if (explicitToken) return explicitToken;

  const adminUser = process.env.KJ_SONAR_ADMIN_USER || config.sonarqube.admin_user || "admin";
  const candidates = [
    process.env.KJ_SONAR_ADMIN_PASSWORD,
    config.sonarqube.admin_password,
    "admin"
  ].filter(Boolean);

  for (const password of [...new Set(candidates)]) {
    const valid = await validateAdminCredentials(apiHost, adminUser, password);
    if (!valid) continue;
    const token = await generateUserToken(apiHost, adminUser, password);
    if (token) return token;
  }

  return null;
}

export async function runSonarScan(config, projectKey = "karajan-default") {
  const rawHost = config.sonarqube.host;
  const apiHost = normalizeApiHost(rawHost);
  const isLocalHost = /localhost|127\.0\.0\.1/.test(rawHost);
  const host = isLocalHost ? rawHost.replace(/localhost|127\.0\.0\.1/g, "host.docker.internal") : rawHost;

  const start = await sonarUp(rawHost);
  if (start.exitCode !== 0) {
    return {
      ok: false,
      stdout: start.stdout || "",
      stderr: start.stderr || "Failed to start SonarQube service",
      exitCode: start.exitCode
    };
  }
  const token = await resolveSonarToken(config, apiHost);
  if (!token) {
    return {
      ok: false,
      stdout: "",
      stderr:
        "Unable to resolve Sonar token. Tried configured token/password and fallback admin/admin.",
      exitCode: 1
    };
  }
  process.env.KJ_SONAR_TOKEN = token;
  const coverage = await ensureCoverageReport();
  if (coverage.exitCode !== 0) {
    return {
      ok: false,
      stdout: coverage.stdout || "",
      stderr: coverage.stderr || "Failed to generate coverage report for SonarQube",
      exitCode: coverage.exitCode
    };
  }
  const scannerConfig = normalizeScannerConfig({
    ...config.sonarqube.scanner,
    javascript_lcov_report_paths: "coverage/lcov.info"
  });

  const args = [
    "run",
    "--rm",
    "-v",
    `${process.cwd()}:/usr/src`,
    ...(isLocalHost ? ["--add-host", "host.docker.internal:host-gateway"] : ["--network", "karajan_sonar_net"]),
    "-e",
    `SONAR_HOST_URL=${host}`,
    "-e",
    `SONAR_TOKEN=${token || ""}`,
    "-e",
    `SONAR_SCANNER_OPTS=${buildScannerOpts(projectKey, scannerConfig)}`,
    "sonarsource/sonar-scanner-cli"
  ];

  const result = await runCommand("docker", args, { timeout: 15 * 60 * 1000 });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

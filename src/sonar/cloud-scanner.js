import { runCommand } from "../utils/process.js";
import { resolveSonarProjectKey } from "./project-key.js";

function buildCloudScannerArgs(projectKey, config) {
  const sc = config.sonarcloud || {};
  const scanner = sc.scanner || {};
  const host = sc.host || "https://sonarcloud.io";
  const token = process.env.KJ_SONARCLOUD_TOKEN || sc.token;
  const organization = process.env.KJ_SONARCLOUD_ORG || sc.organization;

  const args = [
    `-Dsonar.host.url=${host}`,
    `-Dsonar.projectKey=${projectKey}`
  ];

  if (token) args.push(`-Dsonar.token=${token}`);
  if (organization) args.push(`-Dsonar.organization=${organization}`);
  if (scanner.sources) args.push(`-Dsonar.sources=${scanner.sources}`);
  if (scanner.exclusions) args.push(`-Dsonar.exclusions=${scanner.exclusions}`);
  if (scanner.test_inclusions) args.push(`-Dsonar.test.inclusions=${scanner.test_inclusions}`);

  return args;
}

export async function runSonarCloudScan(config, projectKey = null) {
  const sc = config.sonarcloud || {};
  const token = process.env.KJ_SONARCLOUD_TOKEN || sc.token;
  const organization = sc.organization || process.env.KJ_SONARCLOUD_ORG;

  if (!token) {
    return {
      ok: false,
      projectKey: null,
      stdout: "",
      stderr: "SonarCloud token not configured. Set sonarcloud.token in kj.config.yml or KJ_SONARCLOUD_TOKEN env var.",
      exitCode: 1
    };
  }

  if (!organization) {
    return {
      ok: false,
      projectKey: null,
      stdout: "",
      stderr: "SonarCloud organization not configured. Set sonarcloud.organization in kj.config.yml or KJ_SONARCLOUD_ORG env var.",
      exitCode: 1
    };
  }

  let effectiveProjectKey;
  try {
    effectiveProjectKey = projectKey || sc.project_key || await resolveSonarProjectKey(config, { projectKey });
  } catch (error) {
    return {
      ok: false,
      projectKey: null,
      stdout: "",
      stderr: error?.message || String(error),
      exitCode: 1
    };
  }

  const scannerTimeout = 15 * 60 * 1000;
  const args = buildCloudScannerArgs(effectiveProjectKey, config);

  // Use npx @sonar/scan (no Docker needed)
  const result = await runCommand("npx", ["@sonar/scan", ...args], { timeout: scannerTimeout });

  return {
    ok: result.exitCode === 0,
    projectKey: effectiveProjectKey,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

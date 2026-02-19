import { runCommand } from "../utils/process.js";

export function buildScannerOpts(projectKey, scanner = {}) {
  const opts = [`-Dsonar.projectKey=${projectKey}`];
  if (scanner.sources) opts.push(`-Dsonar.sources=${scanner.sources}`);
  if (scanner.exclusions) opts.push(`-Dsonar.exclusions=${scanner.exclusions}`);
  if (scanner.test_inclusions) opts.push(`-Dsonar.test.inclusions=${scanner.test_inclusions}`);
  if (scanner.coverage_exclusions) opts.push(`-Dsonar.coverage.exclusions=${scanner.coverage_exclusions}`);
  const rules = scanner.disabled_rules || [];
  rules.forEach((rule, i) => {
    opts.push(`-Dsonar.issue.ignore.multicriteria=e${i + 1}`);
    opts.push(`-Dsonar.issue.ignore.multicriteria.e${i + 1}.ruleKey=${rule}`);
    opts.push(`-Dsonar.issue.ignore.multicriteria.e${i + 1}.resourceKey=**/*`);
  });
  return opts.join(" ");
}

export async function runSonarScan(config, projectKey = "karajan-default") {
  const token = process.env.KJ_SONAR_TOKEN || config.sonarqube.token;
  const rawHost = config.sonarqube.host;
  const isLocalHost = /localhost|127\.0\.0\.1/.test(rawHost);
  const host = isLocalHost ? rawHost.replace(/localhost|127\.0\.0\.1/g, "host.docker.internal") : rawHost;

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
    `SONAR_SCANNER_OPTS=${buildScannerOpts(projectKey, config.sonarqube.scanner)}`,
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

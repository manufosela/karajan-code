import { runCommand } from "../utils/process.js";

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
    `SONAR_SCANNER_OPTS=-Dsonar.projectKey=${projectKey}`,
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

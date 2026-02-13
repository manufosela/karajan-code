import { runCommand } from "../utils/process.js";

export async function runSonarScan(config, projectKey = "karajan-default") {
  const token = process.env.KJ_SONAR_TOKEN || config.sonarqube.token;
  const host = config.sonarqube.host.replace("localhost", "sonarqube");

  const args = [
    "run",
    "--rm",
    "-v",
    `${process.cwd()}:/usr/src`,
    "--network",
    "karajan_sonar_net",
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

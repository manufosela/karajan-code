import fs from "node:fs/promises";
import { ensureDir } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";
import { getKarajanHome, getSonarComposePath } from "../utils/paths.js";
import { loadConfig } from "../config.js";

const KARAJAN_HOME = getKarajanHome();
const COMPOSE_PATH = getSonarComposePath();

function normalizeSonarConfig(sonarqube = {}) {
  const timeouts = sonarqube.timeouts || {};
  return {
    host: sonarqube.host || "http://localhost:9000",
    external: sonarqube.external === true,
    containerName: sonarqube.container_name || "karajan-sonarqube",
    network: sonarqube.network || "karajan_sonar_net",
    volumes: {
      data: sonarqube?.volumes?.data || "karajan_sonar_data",
      logs: sonarqube?.volumes?.logs || "karajan_sonar_logs",
      extensions: sonarqube?.volumes?.extensions || "karajan_sonar_extensions"
    },
    timeouts: {
      healthcheckSeconds: Number(timeouts.healthcheck_seconds) > 0 ? Number(timeouts.healthcheck_seconds) : 5,
      composeUpMs: Number(timeouts.compose_up_ms) > 0 ? Number(timeouts.compose_up_ms) : 5 * 60 * 1000,
      composeControlMs: Number(timeouts.compose_control_ms) > 0 ? Number(timeouts.compose_control_ms) : 2 * 60 * 1000,
      logsMs: Number(timeouts.logs_ms) > 0 ? Number(timeouts.logs_ms) : 30 * 1000
    }
  };
}

function buildComposeTemplate(sonarConfig) {
  return `services:
  sonarqube:
    image: sonarqube:community
    container_name: ${sonarConfig.containerName}
    ports:
      - "9000:9000"
    volumes:
      - ${sonarConfig.volumes.data}:/opt/sonarqube/data
      - ${sonarConfig.volumes.logs}:/opt/sonarqube/logs
      - ${sonarConfig.volumes.extensions}:/opt/sonarqube/extensions
    environment:
      - SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true
    networks:
      - ${sonarConfig.network}
    restart: unless-stopped

volumes:
  ${sonarConfig.volumes.data}:
  ${sonarConfig.volumes.logs}:
  ${sonarConfig.volumes.extensions}:

networks:
  ${sonarConfig.network}:
    name: ${sonarConfig.network}
`;
}

export async function ensureComposeFile(sonarqube = null) {
  const sonarConfig = sonarqube ? normalizeSonarConfig(sonarqube) : normalizeSonarConfig((await loadConfig()).config.sonarqube);
  const composeTemplate = buildComposeTemplate(sonarConfig);
  await ensureDir(KARAJAN_HOME);
  await fs.writeFile(COMPOSE_PATH, composeTemplate, "utf8");
  return COMPOSE_PATH;
}

export async function isSonarReachable(host, healthcheckSeconds = 5) {
  const timeout = Number(healthcheckSeconds) > 0 ? String(Number(healthcheckSeconds)) : "5";
  const res = await runCommand("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", timeout, `${host}/api/system/status`]);
  return res.exitCode === 0 && res.stdout.trim().startsWith("2");
}

export async function sonarUp(hostOverride = null) {
  const { config } = await loadConfig();
  const sonarConfig = normalizeSonarConfig(config.sonarqube);
  const host = hostOverride || sonarConfig.host;

  if (await isSonarReachable(host, sonarConfig.timeouts.healthcheckSeconds)) {
    return { exitCode: 0, stdout: `SonarQube already reachable at ${host}, skipping container start.`, stderr: "" };
  }

  if (sonarConfig.external) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Configured external SonarQube is not reachable at ${host}.`
    };
  }

  const compose = await ensureComposeFile(config.sonarqube);
  return runCommand("docker", ["compose", "-f", compose, "up", "-d"], { timeout: sonarConfig.timeouts.composeUpMs });
}

export async function sonarDown() {
  const { config } = await loadConfig();
  const sonarConfig = normalizeSonarConfig(config.sonarqube);
  if (sonarConfig.external) {
    return { exitCode: 0, stdout: "sonarqube.external=true, skipping Docker stop.", stderr: "" };
  }
  const compose = await ensureComposeFile(config.sonarqube);
  return runCommand("docker", ["compose", "-f", compose, "stop"], { timeout: sonarConfig.timeouts.composeControlMs });
}

export async function sonarStatus() {
  const { config } = await loadConfig();
  const sonarConfig = normalizeSonarConfig(config.sonarqube);
  const host = sonarConfig.host;

  if (sonarConfig.external) {
    if (await isSonarReachable(host, sonarConfig.timeouts.healthcheckSeconds)) {
      return { exitCode: 0, stdout: `external SonarQube running at ${host}`, stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: `external SonarQube is not reachable at ${host}` };
  }

  const containerRes = await runCommand("docker", ["ps", "--filter", `name=${sonarConfig.containerName}`, "--format", "{{.Status}}"]);
  if (containerRes.stdout?.trim()) return containerRes;

  if (await isSonarReachable(host, sonarConfig.timeouts.healthcheckSeconds)) {
    return { exitCode: 0, stdout: `external SonarQube running at ${host}`, stderr: "" };
  }

  return containerRes;
}

export async function sonarLogs() {
  const { config } = await loadConfig();
  const sonarConfig = normalizeSonarConfig(config.sonarqube);
  if (sonarConfig.external) {
    return { exitCode: 1, stdout: "", stderr: "sonarqube.external=true, Docker logs are not available." };
  }
  return runCommand("docker", ["logs", "--tail", "100", sonarConfig.containerName], { timeout: sonarConfig.timeouts.logsMs });
}

const MIN_MAP_COUNT = 262144;

export async function checkVmMaxMapCount(platform) {
  if (platform === "darwin" || platform === "win32") {
    return { ok: true, reason: "vm.max_map_count check not required on this platform" };
  }

  const res = await runCommand("sysctl", ["vm.max_map_count"]);
  if (res.exitCode !== 0) {
    return {
      ok: false,
      reason: "Could not read vm.max_map_count",
      fix: `sudo sysctl -w vm.max_map_count=${MIN_MAP_COUNT}`
    };
  }

  const match = res.stdout.match(/=\s*(\d+)/);
  const current = match ? Number(match[1]) : 0;

  if (current >= MIN_MAP_COUNT) {
    return { ok: true, reason: `vm.max_map_count = ${current}` };
  }

  return {
    ok: false,
    reason: `vm.max_map_count = ${current} (needs >= ${MIN_MAP_COUNT})`,
    fix: `sudo sysctl -w vm.max_map_count=${MIN_MAP_COUNT} && echo "vm.max_map_count=${MIN_MAP_COUNT}" | sudo tee -a /etc/sysctl.conf`
  };
}

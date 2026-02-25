import fs from "node:fs/promises";
import { ensureDir } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";
import { getKarajanHome, getSonarComposePath } from "../utils/paths.js";
import { loadConfig } from "../config.js";

const KARAJAN_HOME = getKarajanHome();
const COMPOSE_PATH = getSonarComposePath();

const composeTemplate = `services:
  sonarqube:
    image: sonarqube:community
    container_name: karajan-sonarqube
    ports:
      - "9000:9000"
    volumes:
      - karajan_sonar_data:/opt/sonarqube/data
      - karajan_sonar_logs:/opt/sonarqube/logs
      - karajan_sonar_extensions:/opt/sonarqube/extensions
    environment:
      - SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true
    networks:
      - karajan_sonar_net
    restart: unless-stopped

volumes:
  karajan_sonar_data:
  karajan_sonar_logs:
  karajan_sonar_extensions:

networks:
  karajan_sonar_net:
    name: karajan_sonar_net
`;

export async function ensureComposeFile() {
  await ensureDir(KARAJAN_HOME);
  await fs.writeFile(COMPOSE_PATH, composeTemplate, "utf8");
  return COMPOSE_PATH;
}

export async function isSonarReachable(host) {
  const res = await runCommand("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", `${host}/api/system/status`]);
  return res.exitCode === 0 && res.stdout.trim().startsWith("2");
}

export async function sonarUp(hostOverride = null) {
  const { config } = await loadConfig();
  const host = hostOverride || config.sonarqube.host || "http://localhost:9000";

  if (await isSonarReachable(host)) {
    return { exitCode: 0, stdout: `SonarQube already reachable at ${host}, skipping container start.`, stderr: "" };
  }

  const compose = await ensureComposeFile();
  return runCommand("docker", ["compose", "-f", compose, "up", "-d"]);
}

export async function sonarDown() {
  const compose = await ensureComposeFile();
  return runCommand("docker", ["compose", "-f", compose, "stop"]);
}

export async function sonarStatus() {
  const containerRes = await runCommand("docker", ["ps", "--filter", "name=karajan-sonarqube", "--format", "{{.Status}}"]);
  if (containerRes.stdout?.trim()) return containerRes;

  const { config } = await loadConfig();
  const host = config.sonarqube.host || "http://localhost:9000";
  if (await isSonarReachable(host)) {
    return { exitCode: 0, stdout: `external SonarQube running at ${host}`, stderr: "" };
  }

  return containerRes;
}

export async function sonarLogs() {
  return runCommand("docker", ["logs", "--tail", "100", "karajan-sonarqube"]);
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

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";

const KARJAN_HOME = path.join(os.homedir(), ".karajan");
const COMPOSE_PATH = path.join(KARJAN_HOME, "docker-compose.sonar.yml");

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
  await ensureDir(KARJAN_HOME);
  await fs.writeFile(COMPOSE_PATH, composeTemplate, "utf8");
  return COMPOSE_PATH;
}

export async function sonarUp() {
  const compose = await ensureComposeFile();
  return runCommand("docker", ["compose", "-f", compose, "up", "-d"]);
}

export async function sonarDown() {
  const compose = await ensureComposeFile();
  return runCommand("docker", ["compose", "-f", compose, "stop"]);
}

export async function sonarStatus() {
  return runCommand("docker", ["ps", "--filter", "name=karajan-sonarqube", "--format", "{{.Status}}"]);
}

export async function sonarLogs() {
  return runCommand("docker", ["logs", "--tail", "100", "karajan-sonarqube"]);
}

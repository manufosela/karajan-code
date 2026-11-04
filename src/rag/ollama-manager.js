// KJC-TSK-0435 (RAG Auto-Bootstrap PR1) — Ollama-in-Docker manager.
// Mirrors src/sonar/manager.js: write docker-compose, start/stop the
// container, discover a free port, wait for readiness. Next PR wires
// it to `kj init`.
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { ensureDir } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";
import { getKarajanHome, getOllamaComposePath } from "../utils/paths.js";

const DEFAULTS = { port: 11434, hcS: 5, upMs: 300000, ctrlMs: 120000, readyMs: 90000 };
const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);
const MAX_CPUS = 1024;

// HU-3362 — rag.embedder.cpus: finite number in [0, MAX_CPUS]; 0 = no limit.
// Absent → half the cores, min 1. availableParallelism() (not cpus().length)
// because it honours CPU affinity and cgroup limits, so a constrained host
// does not get a limit above what it can actually use.
function resolveCpus(value) {
  if (value === undefined || value === null) return Math.max(1, Math.floor(os.availableParallelism() / 2));
  // Number.isFinite is false for strings, so "2" is rejected on purpose.
  if (!Number.isFinite(value) || value < 0 || value > MAX_CPUS) throw new Error(`rag.embedder.cpus must be a number between 0 and ${MAX_CPUS} (0 = no limit), got ${JSON.stringify(value)}`);
  return value;
}

export function normalizeOllamaConfig(ollama = {}) {
  const t = ollama.timeouts || {};
  const port = Number(ollama.port) || DEFAULTS.port;
  return {
    cpus: resolveCpus(ollama.cpus),
    cpusExplicit: ollama.cpus !== undefined && ollama.cpus !== null,
    host: ollama.host || `http://localhost:${port}`,
    port,
    external: ollama.external === true,
    containerName: ollama.container_name || "kj-ollama",
    volume: ollama.volume || "kj_ollama_data",
    timeouts: {
      healthcheckSeconds: pos(t.healthcheck_seconds, DEFAULTS.hcS),
      composeUpMs: pos(t.compose_up_ms, DEFAULTS.upMs),
      composeControlMs: pos(t.compose_control_ms, DEFAULTS.ctrlMs),
      readyMs: pos(t.ready_ms, DEFAULTS.readyMs),
    },
  };
}

export function buildComposeTemplate(cfg) {
  return `services:
  ollama:
    image: ollama/ollama:latest
    container_name: ${cfg.containerName}
    ports:
      - "${cfg.port}:11434"
    volumes:
      - ${cfg.volume}:/root/.ollama
    restart: unless-stopped
${cfg.cpus > 0 ? `    cpus: ${cfg.cpus}\n` : ""}
volumes:
  ${cfg.volume}:
`;
}

export async function ensureComposeFile(ollama = null, cfg = normalizeOllamaConfig(ollama || {})) {
  await ensureDir(getKarajanHome());
  await fs.writeFile(getOllamaComposePath(), buildComposeTemplate(cfg), "utf8");
  return getOllamaComposePath();
}

export async function isOllamaReachable(host, healthcheckSeconds = DEFAULTS.hcS) {
  const t = String(pos(healthcheckSeconds, DEFAULTS.hcS));
  const r = await runCommand("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", t, `${host}/api/tags`]);
  return r.exitCode === 0 && r.stdout.trim().startsWith("2");
}

export async function findAvailableOllamaPort(start = DEFAULTS.port, span = 10) {
  for (let p = start; p < start + span; p++) {
    const free = await new Promise((res) => {
      const s = net.createServer();
      s.once("error", () => res(false));
      s.once("listening", () => s.close(() => res(true)));
      s.listen(p, "127.0.0.1");
    });
    if (free) return p;
  }
  throw new Error(`No free port in [${start}, ${start + span})`);
}

export async function waitForOllamaReady(host, timeoutMs = DEFAULTS.readyMs) {
  const dl = Date.now() + timeoutMs;
  while (Date.now() < dl) {
    if (await isOllamaReachable(host, 2)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// Current CPU limit of the container (0 = unlimited), or null when there is no such container.
async function containerCpus(cfg) {
  const r = await runCommand("docker", ["inspect", "--format", "{{.HostConfig.NanoCpus}}", cfg.containerName]);
  const nano = Number(r.stdout.trim());
  return r.exitCode === 0 && Number.isFinite(nano) ? nano / 1e9 : null;
}

// HU-3362 — bring a RUNNING container to rag.embedder.cpus. Args go to docker
// as an array (no shell); the value was validated in normalizeOllamaConfig.
async function applyCpuLimit(cfg) {
  if (cfg.external) return cfg.cpusExplicit ? "rag.embedder.cpus ignored: rag.embedder.external is true." : "";
  const current = await containerCpus(cfg);
  if (current === null || current === cfg.cpus) return "";
  if (!cfg.cpusExplicit && current > 0) return ""; // limit set by hand: respected
  const r = await runCommand("docker", ["update", "--cpus", String(cfg.cpus), cfg.containerName]);
  if (r.exitCode !== 0) throw new Error(`Could not set the CPU limit of ${cfg.containerName}: ${r.stderr.trim()}`);
  return `${cfg.containerName}: CPU limit ${cfg.cpus || "removed"} (was ${current || "unlimited"}).`;
}

const withNote = (res, note) => (note ? { ...res, stdout: [res.stdout, note].filter(Boolean).join("\n") } : res);

// A failed `docker update` is a failed start: the requested limit is not in force.
async function reachableResult(cfg, res) {
  try {
    return withNote(res, await applyCpuLimit(cfg));
  } catch (err) {
    return { ...res, exitCode: 1, stderr: err.message };
  }
}

export async function ollamaUp(ollama = null) {
  const cfg = normalizeOllamaConfig(ollama || {});
  if (await isOllamaReachable(cfg.host, cfg.timeouts.healthcheckSeconds)) {
    const res = { exitCode: 0, stdout: `Ollama already reachable at ${cfg.host}, skipping container start.`, stderr: "", reusedHost: cfg.host };
    return reachableResult(cfg, res);
  }
  if (cfg.external) return { exitCode: 1, stdout: "", stderr: `Configured external Ollama is not reachable at ${cfg.host}.` };
  // A stopped container with a hand-set limit keeps it when compose recreates it.
  const current = cfg.cpusExplicit ? null : await containerCpus(cfg);
  if (current > 0) cfg.cpus = current;
  const compose = await ensureComposeFile(ollama, cfg);
  const res = await runCommand("docker", ["compose", "-f", compose, "up", "-d"], { timeout: cfg.timeouts.composeUpMs });
  return withNote(res, res.exitCode === 0 && cfg.cpus > 0 ? `${cfg.containerName}: CPU limit ${cfg.cpus}.` : "");
}

export async function ollamaDown(ollama = null) {
  const cfg = normalizeOllamaConfig(ollama || {});
  if (cfg.external) return { exitCode: 0, stdout: "ollama.external=true, skipping Docker stop.", stderr: "" };
  const compose = await ensureComposeFile(ollama);
  return runCommand("docker", ["compose", "-f", compose, "stop"], { timeout: cfg.timeouts.composeControlMs });
}

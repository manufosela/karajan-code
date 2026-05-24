// KJC-TSK-0435 (RAG Auto-Bootstrap PR1) — Ollama-in-Docker manager.
// Mirrors src/sonar/manager.js: write docker-compose, start/stop the
// container, discover a free port, wait for readiness. Next PR wires
// it to `kj init`.
import fs from "node:fs/promises";
import net from "node:net";
import { ensureDir } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";
import { getKarajanHome, getOllamaComposePath } from "../utils/paths.js";

const DEFAULTS = { port: 11434, hcS: 5, upMs: 300000, ctrlMs: 120000, readyMs: 90000 };
const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);

export function normalizeOllamaConfig(ollama = {}) {
  const t = ollama.timeouts || {};
  const port = Number(ollama.port) || DEFAULTS.port;
  return {
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

volumes:
  ${cfg.volume}:
`;
}

export async function ensureComposeFile(ollama = null) {
  const cfg = normalizeOllamaConfig(ollama || {});
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

export async function ollamaUp(ollama = null) {
  const cfg = normalizeOllamaConfig(ollama || {});
  if (await isOllamaReachable(cfg.host, cfg.timeouts.healthcheckSeconds)) {
    return { exitCode: 0, stdout: `Ollama already reachable at ${cfg.host}, skipping container start.`, stderr: "", reusedHost: cfg.host };
  }
  if (cfg.external) return { exitCode: 1, stdout: "", stderr: `Configured external Ollama is not reachable at ${cfg.host}.` };
  const compose = await ensureComposeFile(ollama);
  return runCommand("docker", ["compose", "-f", compose, "up", "-d"], { timeout: cfg.timeouts.composeUpMs });
}

export async function ollamaDown(ollama = null) {
  const cfg = normalizeOllamaConfig(ollama || {});
  if (cfg.external) return { exitCode: 0, stdout: "ollama.external=true, skipping Docker stop.", stderr: "" };
  const compose = await ensureComposeFile(ollama);
  return runCommand("docker", ["compose", "-f", compose, "stop"], { timeout: cfg.timeouts.composeControlMs });
}

// KJC-TSK-0436 (RAG Auto-Bootstrap PR2) — Capability check for Ollama
// bootstrap. Returns whether the host can reasonably run a local Ollama
// container: Docker installed, daemon reachable, and enough RAM
// (default >= 4 GB free). The caller (kj init) decides whether to
// bootstrap, warn, or skip.
import os from "node:os";
import { runCommand } from "../utils/process.js";

const DEFAULT_MIN_RAM_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB free
const DEFAULT_TIMEOUT_MS = 5000;

export async function checkDockerAvailable(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const v = await runCommand("docker", ["--version"], { timeout: timeoutMs }).catch(() => ({ exitCode: 127 }));
  if (v.exitCode !== 0) return { ok: false, reason: "docker:not-installed" };
  const info = await runCommand("docker", ["info"], { timeout: timeoutMs }).catch(() => ({ exitCode: 1 }));
  if (info.exitCode !== 0) return { ok: false, reason: "docker:daemon-unreachable" };
  return { ok: true };
}

export function checkRamCapacity(minBytes = DEFAULT_MIN_RAM_BYTES) {
  const free = os.freemem();
  const total = os.totalmem();
  if (free < minBytes) {
    return {
      ok: false,
      reason: `ram:insufficient (${formatGB(free)} free < ${formatGB(minBytes)} required)`,
      freeBytes: free,
      totalBytes: total,
    };
  }
  return { ok: true, freeBytes: free, totalBytes: total };
}

/**
 * Combined capability check. Returns `{ capable, reasons[] }`.
 * Caller decides what to do (bootstrap, warn, skip).
 */
export async function checkOllamaCapability({ minRamBytes = DEFAULT_MIN_RAM_BYTES } = {}) {
  const reasons = [];
  const docker = await checkDockerAvailable();
  if (!docker.ok) reasons.push(docker.reason);
  const ram = checkRamCapacity(minRamBytes);
  if (!ram.ok) reasons.push(ram.reason);
  return { capable: reasons.length === 0, reasons, docker, ram };
}

function formatGB(bytes) {
  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
}

/**
 * Pull a model into the Ollama container. Uses `docker exec` so we do
 * not depend on the host having `ollama` CLI installed. Wired by `kj
 * init` after `ollamaUp`, and by `kj ollama pull <model>` (PR3).
 */
export async function pullOllamaModel(model, { containerName = "kj-ollama", timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!model || typeof model !== "string") throw new Error("pullOllamaModel: model is required");
  return runCommand("docker", ["exec", containerName, "ollama", "pull", model], { timeout: timeoutMs });
}

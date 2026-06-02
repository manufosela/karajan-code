// Advisory hardware checks: warn (not fail) so the pipeline keeps running.
// RAM < 4 GB silently OOM-kills the RAG embedder; disk < 5 GB corrupts
// Ollama model shards. GPU detection is best-effort and never throws.

import os from "node:os";
import { statfs } from "node:fs/promises";
import { spawn } from "node:child_process";
import { STRATEGY } from "./types.js";

const RAM_WARN_GB = 4;
const RAM_RECOMMENDED_GB = 8;
const DISK_WARN_GB = 5;
const DISK_RECOMMENDED_GB = 20;
const GPU_DETECT_TIMEOUT_MS = 1500;

const bytesToGb = (bytes) => Math.round((bytes / 1024 ** 3) * 10) / 10;
const info = (detail, extra) => ({ ok: true, severity: "info", detail, extra });
const warn = (detail, fix, extra) => ({ ok: false, severity: "warn", detail, fix, extra });

function createRamCheck() {
  return {
    name: "hw-ram",
    label: "System RAM",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const totalGb = bytesToGb(os.totalmem());
      const freeGb = bytesToGb(os.freemem());
      const base = `${totalGb} GB total, ${freeGb} GB free`;
      if (totalGb < RAM_WARN_GB) {
        return warn(
          `${base} (RAG embedder needs >=${RAM_WARN_GB} GB)`,
          "Disable local RAG (kj init --no-rag) or switch rag.embedder.provider to openai/voyage/cohere.",
          { totalGb, freeGb, threshold: RAM_WARN_GB }
        );
      }
      if (totalGb < RAM_RECOMMENDED_GB) {
        return info(`${base} (>=${RAM_RECOMMENDED_GB} GB recommended for parallel runs)`, { totalGb, freeGb });
      }
      return info(base, { totalGb, freeGb });
    },
  };
}

function createCpuCheck() {
  return {
    name: "hw-cpu",
    label: "CPU",
    strategy: STRATEGY.NONE,
    async detect() {
      const cpus = os.cpus();
      const model = cpus[0]?.model?.trim() || "unknown";
      const cores = cpus.length;
      const arch = os.arch();
      return info(`${cores} cores, ${arch} (${model})`, { cores, arch, model });
    },
  };
}

function createDiskCheck() {
  return {
    name: "hw-disk",
    label: "Disk space (cwd)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      try {
        const stat = await statfs(process.cwd());
        const freeGb = bytesToGb(stat.bsize * stat.bavail);
        if (freeGb < DISK_WARN_GB) {
          return warn(
            `${freeGb} GB free (>=${DISK_WARN_GB} GB recommended)`,
            "Free disk space. Ollama models alone take 3-5 GB; the RAG store grows ~50 MB per 1k LOC indexed.",
            { freeGb, threshold: DISK_WARN_GB }
          );
        }
        const note = freeGb < DISK_RECOMMENDED_GB ? ` (>=${DISK_RECOMMENDED_GB} GB recommended)` : "";
        return info(`${freeGb} GB free${note}`, { freeGb });
      } catch (err) {
        return info(`Cannot read free disk space: ${err.message}`);
      }
    },
  };
}

function runGpuCommand(cmd, args) {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* noop */ }
        finish(null);
      }, GPU_DETECT_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.on("error", () => { clearTimeout(timer); finish(null); });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code === 0 ? stdout : null);
      });
    } catch {
      finish(null);
    }
  });
}

async function detectGpu() {
  const platform = process.platform;
  if (platform === "linux" || platform === "win32") {
    const out = await runGpuCommand("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
    const model = out?.split("\n").map((l) => l.trim()).find(Boolean);
    if (model) return { vendor: "NVIDIA", model };
    return null;
  }
  if (platform === "darwin") {
    const out = await runGpuCommand("system_profiler", ["SPDisplaysDataType"]);
    if (!out) return null;
    const match = out.match(/Chipset Model:\s*(.+)/);
    if (!match) return null;
    const model = match[1].trim();
    const vendor = /Apple/i.test(model) ? "Apple" : /AMD|Radeon/i.test(model) ? "AMD" : /Intel/i.test(model) ? "Intel" : "GPU";
    return { vendor, model };
  }
  return null;
}

function createGpuCheck() {
  return {
    name: "hw-gpu",
    label: "GPU",
    strategy: STRATEGY.NONE,
    async detect() {
      const gpu = await detectGpu();
      if (!gpu) {
        return info("No discrete GPU detected (CPU-only)", { detected: false });
      }
      return info(`${gpu.vendor} ${gpu.model}`, { detected: true, vendor: gpu.vendor, model: gpu.model });
    },
  };
}

export function getHardwareChecks() {
  return [createRamCheck(), createCpuCheck(), createDiskCheck(), createGpuCheck()];
}

export const __test = { RAM_WARN_GB, RAM_RECOMMENDED_GB, DISK_WARN_GB, DISK_RECOMMENDED_GB, GPU_DETECT_TIMEOUT_MS, bytesToGb, detectGpu };

// HU-3364 — is the kj-ollama container over its CPU budget, and which `kj rag index` is behind it?
// Read-only: it never runs `docker update` and never signals a process. Shared by `kj doctor` and the Steward.
import { existsSync, readlinkSync } from "node:fs";
import os from "node:os";
import { runCommand } from "../utils/process.js";
import { indexLeasePath, parsePs, readLease } from "../rag/pid-lease.js";
import { STRATEGY } from "./types.js";

const GAP_MS = 5000;
// Absolute paths, as in pid-lease: a ps or lsof found through PATH could be forged.
const bin = (...paths) => paths.find((p) => existsSync(p)) ?? paths[0];
const PS = bin("/bin/ps", "/usr/bin/ps");
const LSOF = bin("/usr/sbin/lsof", "/usr/bin/lsof");
const INDEXER = /(?:^|[\s/])kj(?:\.js)?\s+rag\s+index\b/;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (run) => async (cmd, args) => { try { return await run(cmd, args); } catch (err) { return { exitCode: 1, stdout: "", stderr: err.message }; } };

const elapsedLabel = (ms) => `${Math.floor(ms / 60000)}m${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;
// /proc where it exists, else lsof (macOS has no /proc).
const cwdOf = async (pid, { run, readCwd }) => readCwd(pid) ?? (await run(LSOF, ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])).stdout.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? "unknown";
async function findIndexers(io) {
  const lease = io.lease();
  const found = [];
  for (const line of (await io.run(PS, ["-axo", "pid=,etime=,command="])).stdout.split("\n")) {
    const m = /^\s*(\d+)\s(.+)$/.exec(line);
    const ps = m && parsePs(m[2]);
    const pid = Number(m?.[1]);
    if (!ps || !INDEXER.test(ps.command) || pid === process.pid) continue;
    found.push({ pid, elapsed: elapsedLabel(ps.elapsedMs), cwd: await cwdOf(pid, io), holdsLease: Boolean(lease?.running && lease.pid === pid) });
  }
  return found;
}

export async function probeEmbedderLoad(config, io = {}) {
  const e = config?.rag?.embedder;
  if (config?.rag?.preload?.enabled !== true) return { state: "skipped", reason: "RAG preload is off" };
  if ((e?.provider ?? "ollama") !== "ollama" || e?.external === true) return { state: "skipped", reason: "the embedder does not run in the kj-ollama container" };
  const full = {
    run: safe(io.run ?? runCommand), sleep: io.sleep ?? sleepMs, cores: io.cores ?? os.availableParallelism(),
    readCwd: io.readCwd ?? ((pid) => { try { return readlinkSync(`/proc/${pid}/cwd`); } catch { return null; } }),
    lease: io.lease ?? (() => readLease(indexLeasePath())),
  };
  const container = e?.container_name || "kj-ollama";
  const inspect = await full.run("docker", ["inspect", "--format", "{{.HostConfig.NanoCpus}}", container]);
  if (inspect.exitCode !== 0) return { state: "skipped", reason: /no such/i.test(inspect.stderr) ? `${container} is not running` : "Docker is not available" };
  // Budget (one number, in docker stats' unit: 100 % = one core): the container's own CPU limit when set, else half the host cores.
  const nano = Number(inspect.stdout.trim());
  const budget = nano > 0 ? (nano / 1e9) * 100 : Math.max(1, Math.floor(full.cores / 2)) * 100;
  const sample = async () => Number.parseFloat((await full.run("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}}", container])).stdout);
  const noReading = { state: "skipped", reason: `no CPU reading for ${container}` };
  const first = await sample();
  if (Number.isNaN(first)) return noReading;
  if (first <= budget) return { state: "ok", cpu: first, budget, container };
  await full.sleep(GAP_MS); // a spike is not a verdict: the second sample must also be over
  const second = await sample();
  if (Number.isNaN(second)) return noReading;
  return second > budget ? { state: "over", cpu: second, budget, container, samples: [first, second], indexers: await findIndexers(full) } : { state: "ok", cpu: second, budget, container };
}
const FIXES = [
  "set rag.embedder.cpus (default: half the cores; 0 = no limit)",
  "the machine lease lets one indexer run: wait for the one that holds it, or stop the other kj rag index pids yourself",
  "if `kj rag query` warns `predates the embedded header`, the index is stale: rebuild it once (kj rag index --with-sources)",
];
const pct = (n) => `${Math.round(n)}%`;
const cause = ({ indexers }) => indexers.length === 0
  ? "no kj rag index is running: the load is not from a kj indexer"
  : indexers.map((i) => `kj rag index pid ${i.pid} (${i.elapsed}, ${i.cwd}, ${i.holdsLease ? "holds" : "does not hold"} the machine lease)`).join("; ");
const overFacts = (r) => `${r.container} at ${r.samples.map(pct).join(" then ")} CPU, over its ${pct(r.budget)} budget in two samples ${GAP_MS / 1000}s apart; ${cause(r)}`;

function renderLoad(r) {
  if (r.state === "skipped") return { ok: true, severity: "info", detail: `skipped: ${r.reason}` };
  if (r.state === "ok") return { ok: true, severity: "info", detail: `${r.container} at ${pct(r.cpu)} CPU, within its ${pct(r.budget)} budget` };
  return { ok: false, severity: "warn", detail: overFacts(r), fix: FIXES.map((f, i) => `${i + 1}. ${f}`).join(" ") };
}

/** Steward invariant: over budget is broken (same facts); nothing to probe, or a fine load, is ok. */
export function evaluateEmbedderLoad(probe) {
  if (!probe) return { verdict: "unknown", evidence: "the embedder load could not be probed", remedy: "refresh: run kj doctor" };
  if (probe.state !== "over") return { verdict: "ok", evidence: renderLoad(probe).detail, remedy: null };
  return { verdict: "broken", evidence: overFacts(probe), remedy: FIXES.join("; then ") };
}

export function getEmbedderLoadChecks() {
  return [{
    name: "embedder-load",
    label: "Embedder CPU load",
    strategy: STRATEGY.NONE,
    detectTimeoutMs: 60_000,
    render: renderLoad,
    async detect({ config }) { return renderLoad(await probeEmbedderLoad(config)); },
  }];
}

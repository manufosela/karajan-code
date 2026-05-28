// KJC-TSK-0470 — Bootstrap Docker de ai-harness-scorecard.
// One-shot container: detect Docker, auto-pull on first run (cache hit
// thereafter), execute `assess <repo>` with the project mounted read-only.
// No compose, no port discovery — assess is a single process that exits.
import { runCommand } from "../utils/process.js";

const D = { image: "markmishaev76/ai-harness-scorecard:latest", pullTimeoutMs: 300000, assessTimeoutMs: 180000 };
const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);

export function normalizeHarnessConfig(h = {}) {
  return {
    enabled: h.enabled !== false,
    image: h.image || D.image,
    pullTimeoutMs: pos(h.pull_timeout_ms, D.pullTimeoutMs),
    assessTimeoutMs: pos(h.assess_timeout_ms, D.assessTimeoutMs),
  };
}

export async function isDockerAvailable() {
  try {
    const r = await runCommand("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 10000 });
    return r.exitCode === 0;
  } catch { return false; }
}

export async function isHarnessImagePresent(image) {
  const r = await runCommand("docker", ["images", "-q", image], { timeout: 10000 });
  return r.exitCode === 0 && r.stdout.trim().length > 0;
}

export async function ensureHarnessImage(harness = null) {
  const cfg = normalizeHarnessConfig(harness || {});
  if (await isHarnessImagePresent(cfg.image)) return { pulled: false, reused: true, image: cfg.image };
  const r = await runCommand("docker", ["pull", cfg.image], { timeout: cfg.pullTimeoutMs });
  if (r.exitCode !== 0) return { pulled: false, reused: false, image: cfg.image, error: r.stderr?.trim() || `exit ${r.exitCode}` };
  return { pulled: true, reused: false, image: cfg.image };
}

export async function runHarnessAssess(repoPath, harness = null) {
  const cfg = normalizeHarnessConfig(harness || {});
  const r = await runCommand(
    "docker",
    ["run", "--rm", "-v", `${repoPath}:/repo:ro`, cfg.image, "assess", "/repo", "--format", "json"],
    { timeout: cfg.assessTimeoutMs },
  );
  if (r.exitCode !== 0) return { ok: false, error: r.stderr?.trim() || r.stdout?.trim() || `exit ${r.exitCode}` };
  try {
    const parsed = JSON.parse(r.stdout);
    return { ok: true, score: parsed.overall_score, grade: parsed.grade, raw: parsed };
  } catch (e) { return { ok: false, error: `Invalid JSON from harness: ${e.message}` }; }
}

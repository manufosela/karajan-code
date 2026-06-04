// KJC-TSK-0470 — Bootstrap Docker de ai-harness-scorecard.
// One-shot container: detect Docker, auto-pull on first run (cache hit
// thereafter), execute `assess <repo>` with the project mounted read-only.
// No compose, no port discovery — assess is a single process that exits.
//
// KJC-BUG-0077 — classify failures (docker_missing / image_inaccessible /
// auth_required / network_error / unknown) and emit an actionable hint
// alongside the raw stderr so `kj audit` surfaces something better than
// the opaque "pull access denied" line the registry returns.
import { runCommand } from "../utils/process.js";

const D = { image: "markmishaev76/ai-harness-scorecard:latest", pullTimeoutMs: 300000, assessTimeoutMs: 180000 };
const pos = (v, d) => (Number(v) > 0 ? Number(v) : d);

const DOCKER_FAILURE_PATTERNS = [
  { reason: "image_inaccessible", re: /pull access denied|repository does not exist|manifest unknown|not found: manifest|denied: requested access/i },
  { reason: "auth_required",      re: /unauthorized|authentication required|login required|requires authentication/i },
  { reason: "network_error",      re: /no such host|connection refused|dial tcp|i\/o timeout|TLS handshake|net\/http|temporary failure in name resolution/i },
];

export function classifyDockerFailure(stderr = "") {
  const s = String(stderr);
  for (const { reason, re } of DOCKER_FAILURE_PATTERNS) {
    if (re.test(s)) return reason;
  }
  return "unknown";
}

export function hintForReason(reason, image) {
  switch (reason) {
    case "image_inaccessible":
      return `Image \`${image}\` is not accessible from the public registry (it may have been removed, renamed, or made private). Either run \`kj audit --no-harness\` to skip this step, or override \`audit.harness.image\` with a mirror you control.`;
    case "auth_required":
      return `Pulling \`${image}\` requires registry authentication. Run \`docker login <registry>\` first, or override \`audit.harness.image\` with a public mirror.`;
    case "network_error":
      return `Network error reaching the registry while pulling \`${image}\`. Retry once connectivity is back; \`kj audit --no-harness\` skips this step in the meantime.`;
    case "docker_missing":
      return `Docker is not available on this machine. Install Docker (or run \`kj audit --no-harness\` to silence this).`;
    default: return null;
  }
}

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
  if (r.exitCode !== 0) {
    const stderr = r.stderr?.trim() || `exit ${r.exitCode}`;
    const reason = classifyDockerFailure(stderr);
    return { pulled: false, reused: false, image: cfg.image, error: stderr, reason };
  }
  return { pulled: true, reused: false, image: cfg.image };
}

export async function runHarnessAssess(repoPath, harness = null) {
  const cfg = normalizeHarnessConfig(harness || {});
  if (!(await isDockerAvailable())) {
    return { ok: false, reason: "docker_missing", image: cfg.image, error: "Docker daemon is not available", hint: hintForReason("docker_missing", cfg.image) };
  }
  const pull = await ensureHarnessImage(cfg);
  if (pull.error) {
    const reason = pull.reason || "pull_failed";
    return { ok: false, reason, image: cfg.image, error: pull.error, hint: hintForReason(reason, cfg.image) };
  }
  const r = await runCommand(
    "docker",
    ["run", "--rm", "-v", `${repoPath}:/repo:ro`, cfg.image, "assess", "/repo", "--format", "json"],
    { timeout: cfg.assessTimeoutMs },
  );
  if (r.exitCode !== 0) {
    const stderr = r.stderr?.trim() || r.stdout?.trim() || `exit ${r.exitCode}`;
    const reason = classifyDockerFailure(stderr);
    return { ok: false, reason, image: cfg.image, error: stderr, hint: hintForReason(reason, cfg.image) };
  }
  try {
    const parsed = JSON.parse(r.stdout);
    return { ok: true, score: parsed.overall_score, grade: parsed.grade, raw: parsed };
  } catch (e) { return { ok: false, reason: "invalid_json", error: `Invalid JSON from harness: ${e.message}` }; }
}

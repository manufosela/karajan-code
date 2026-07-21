/**
 * `kj agent run <agent> "<task>"` (AB-D, KJC-TSK-0654) — the brain's
 * inter-agent bus. The host agent decides WHO does WHAT; kj provides the
 * plumbing it shouldn't have to fight: binary detection, subprocess
 * workarounds (CLAUDECODE strip, stdin, silence timeouts), usage capture.
 * The brain reads the output and decides — kj never interprets it.
 */
import { createAgent, getAvailableAgents } from "../agents/index.js";
import { detectAvailableAgents } from "../utils/agent-detect.js";

export async function agentRunCommand({ agent, task, config = {}, logger = null, flags = {} }) {
  if (!task || !task.trim()) {
    throw new Error("kj agent run requires a task: kj agent run <agent> \"<task>\"");
  }
  const known = getAvailableAgents().map((a) => a.name);
  const detected = await detectAvailableAgents();
  const up = detected.filter((a) => a.available).map((a) => a.name).join(", ") || "none";
  if (!known.includes(agent)) {
    throw new Error(`unknown agent "${agent}" — supported: ${known.join(", ")}; available on this machine: ${up}`);
  }
  const entry = detected.find((a) => a.name === agent);
  if (!entry?.available) {
    throw new Error(`agent "${agent}" is not available on this machine (available: ${up}) — install its CLI or pick another`);
  }

  let timeoutMs;
  if (flags.timeoutMinutes !== undefined) {
    const minutes = Number(flags.timeoutMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error(`--timeout-minutes must be a positive number, got "${flags.timeoutMinutes}"`);
    }
    timeoutMs = minutes * 60000;
  }

  // --json must emit ONLY the serialized result — no informational lines,
  // and a crash of the delegated subprocess still yields one JSON payload.
  if (!flags.json) logger?.info?.(`kj agent run: delegating to ${agent}`);
  const instance = createAgent(agent, config, logger);
  let result;
  try {
    result = await instance.runTask({ prompt: task, role: "delegate", timeoutMs });
  } catch (err) {
    result = { ok: false, output: "", error: err.message };
  }

  const res = {
    ok: Boolean(result?.ok),
    agent,
    output: result?.output || "",
    error: result?.error || null,
    usage: result?.tokens_out != null
      ? { tokens_in: result.tokens_in ?? null, tokens_out: result.tokens_out, cached_tokens: result.cached_tokens ?? null }
      : null,
  };
  if (flags.json) {
    console.log(JSON.stringify(res));
  } else {
    if (res.output) console.log(res.output);
    if (!res.ok && res.error) console.error(res.error);
  }
  process.exitCode = res.ok ? 0 : 1;
  return res;
}

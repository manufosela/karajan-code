import { createAgent } from "../agents/index.js";
import { addCheckpoint } from "../session/store.js";
import { detectRateLimit } from "../utils/rate-limit-detector.js";

/**
 * Run a coder-like role with fallback on rate limit.
 * Tries the primary agent first. If it fails with a rate limit,
 * switches to the fallback agent (if configured).
 * Non-rate-limit failures stop immediately (no fallback).
 *
 * Returns { execResult, attempts, allRateLimited }
 */
export async function runCoderWithFallback({
  coderName,
  fallbackCoder,
  config,
  logger,
  emitter,
  RoleClass,
  roleInput,
  session,
  iteration,
  onAttemptResult
}) {
  const candidates = [coderName];
  if (fallbackCoder && fallbackCoder !== coderName) {
    candidates.push(fallbackCoder);
  }

  const attempts = [];

  for (const name of candidates) {
    const agentConfig = {
      ...config,
      roles: { ...config.roles, coder: { ...config.roles?.coder, provider: name } }
    };

    const role = new RoleClass({ config: agentConfig, logger, emitter, createAgentFn: createAgent });
    await role.init();

    const execResult = await role.execute(roleInput);

    if (onAttemptResult) {
      await onAttemptResult({ coder: name, result: execResult.result });
    }

    const rateLimited = !execResult.ok && detectRateLimit({
      stderr: execResult.result?.error || "",
      stdout: execResult.result?.output || ""
    }).isRateLimit;

    attempts.push({
      coder: name,
      ok: execResult.ok,
      rateLimited,
      result: execResult.result,
      execResult
    });

    await addCheckpoint(session, {
      stage: "coder-attempt",
      iteration,
      coder: name,
      ok: execResult.ok,
      rateLimited
    });

    if (execResult.ok) {
      return { execResult, attempts, allRateLimited: false };
    }

    // Only fallback on rate limit errors
    if (!rateLimited) {
      return { execResult: null, attempts, allRateLimited: false };
    }

    logger.warn(`Agent ${name} hit rate limit, trying fallback...`);
  }

  return { execResult: null, attempts, allRateLimited: true };
}

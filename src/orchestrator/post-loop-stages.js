import { TesterRole } from "../roles/tester-role.js";
import { SecurityRole } from "../roles/security-role.js";
import { addCheckpoint, saveSession } from "../session-store.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { invokeSolomon } from "./solomon-escalation.js";

const KNOWN_AGENTS = ["claude", "codex", "gemini"];

/**
 * Build an ordered fallback chain for a role.
 * Primary provider first, then remaining known agents (no duplicates).
 */
function buildFallbackChain(config, roleName) {
  const primary =
    config?.roles?.[roleName]?.provider ||
    config?.roles?.coder?.provider ||
    config?.coder ||
    "claude";
  return [primary, ...KNOWN_AGENTS.filter((a) => a !== primary)];
}

/**
 * Detect if a role output is an agent/spawn failure (vs a genuine evaluation failure).
 * Agent failures have `result.error` but no `result.verdict`.
 */
function isAgentFailure(output) {
  if (!output || output.ok) return false;
  return Boolean(output.result?.error) && !output.result?.verdict;
}

/**
 * Run a role (TesterRole or SecurityRole) with agent fallback chain.
 * If the primary agent fails to start (spawn/auth failure), tries the next agent.
 * Genuine evaluation failures (agent ran but verdict=fail) are NOT retried.
 *
 * @returns {{ output, provider, attempts }}
 */
async function runRoleWithFallback(RoleClass, { roleName, config, logger, emitter, eventBase, task, iteration, diff }) {
  const chain = buildFallbackChain(config, roleName);
  const attempts = [];

  for (const provider of chain) {
    const overrideConfig = {
      ...config,
      roles: { ...config.roles, [roleName]: { ...config.roles?.[roleName], provider } }
    };

    const role = new RoleClass({ config: overrideConfig, logger, emitter });
    await role.init({ task, iteration });

    const start = Date.now();
    let output;
    try {
      output = await role.run({ task, diff });
    } catch (err) {
      output = {
        ok: false,
        result: { error: err.message, provider },
        summary: `${roleName} threw: ${err.message}`
      };
    }
    const duration = Date.now() - start;

    attempts.push({ provider, ok: output.ok, duration, summary: output.summary });

    if (output.ok || !isAgentFailure(output)) {
      // Either success or a genuine evaluation failure — don't try another agent
      return { output, provider, attempts };
    }

    // Agent failure — log and try next
    logger.warn(`${roleName} agent "${provider}" failed (${duration}ms): ${output.summary} — trying next agent`);
    emitProgress(emitter, makeEvent(`${roleName}:fallback`, { ...eventBase, stage: roleName }, {
      status: "warn",
      message: `Agent "${provider}" failed, falling back`,
      detail: { provider, duration, summary: output.summary, remaining: chain.length - attempts.length }
    }));
  }

  // All agents failed
  const lastAttempt = attempts[attempts.length - 1];
  const allProviders = attempts.map((a) => a.provider).join(", ");
  logger.error(`${roleName}: all agents failed (${allProviders})`);

  return {
    output: {
      ok: false,
      result: { error: `All agents failed: ${allProviders}`, attempts },
      summary: `All ${roleName} agents failed (${allProviders}) — check agent installation and configuration`
    },
    provider: lastAttempt?.provider,
    attempts
  };
}

export async function runTesterStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff, askQuestion }) {
  logger.setContext({ iteration, stage: "tester" });
  emitProgress(
    emitter,
    makeEvent("tester:start", { ...eventBase, stage: "tester" }, {
      message: "Tester evaluating test quality"
    })
  );

  const testerStart = Date.now();
  const { output: testerOutput, provider, attempts } = await runRoleWithFallback(
    TesterRole,
    { roleName: "tester", config, logger, emitter, eventBase, task, iteration, diff }
  );
  const totalDuration = Date.now() - testerStart;

  trackBudget({
    role: "tester",
    provider: provider || coderRole.provider,
    model: config?.roles?.tester?.model || coderRole.model,
    result: testerOutput,
    duration_ms: totalDuration
  });

  await addCheckpoint(session, {
    stage: "tester",
    iteration,
    ok: testerOutput.ok,
    provider: provider || coderRole.provider,
    model: config?.roles?.tester?.model || coderRole.model || null,
    attempts: attempts.length > 1 ? attempts : undefined
  });

  emitProgress(
    emitter,
    makeEvent("tester:end", { ...eventBase, stage: "tester" }, {
      status: testerOutput.ok ? "ok" : "fail",
      message: testerOutput.ok ? "Tester passed" : `Tester: ${testerOutput.summary}`
    })
  );

  if (!testerOutput.ok) {
    const maxTesterRetries = config.session?.max_tester_retries ?? 1;
    session.tester_retry_count = (session.tester_retry_count || 0) + 1;
    await saveSession(session);

    if (session.tester_retry_count >= maxTesterRetries) {
      const solomonResult = await invokeSolomon({
        config, logger, emitter, eventBase, stage: "tester", askQuestion, session, iteration,
        conflict: {
          stage: "tester",
          task,
          diff,
          iterationCount: session.tester_retry_count,
          maxIterations: maxTesterRetries,
          history: [{ agent: "tester", feedback: testerOutput.summary }]
        }
      });

      if (solomonResult.action === "pause") {
        return { action: "pause", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "tester_fail_fast" } };
      }
      if (solomonResult.action === "subtask") {
        return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "tester_subtask" } };
      }
      // Solomon approved — proceed to next stage
      return { action: "ok" };
    }

    session.last_reviewer_feedback = `Tester feedback: ${testerOutput.summary}`;
    await saveSession(session);
    return { action: "continue" };
  }

  session.tester_retry_count = 0;
  return { action: "ok", stageResult: { ok: true, summary: testerOutput.summary || "All tests passed" } };
}

export async function runSecurityStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff, askQuestion }) {
  logger.setContext({ iteration, stage: "security" });
  emitProgress(
    emitter,
    makeEvent("security:start", { ...eventBase, stage: "security" }, {
      message: "Security auditing code"
    })
  );

  const securityStart = Date.now();
  const { output: securityOutput, provider, attempts } = await runRoleWithFallback(
    SecurityRole,
    { roleName: "security", config, logger, emitter, eventBase, task, iteration, diff }
  );
  const totalDuration = Date.now() - securityStart;

  trackBudget({
    role: "security",
    provider: provider || coderRole.provider,
    model: config?.roles?.security?.model || coderRole.model,
    result: securityOutput,
    duration_ms: totalDuration
  });

  await addCheckpoint(session, {
    stage: "security",
    iteration,
    ok: securityOutput.ok,
    provider: provider || coderRole.provider,
    model: config?.roles?.security?.model || coderRole.model || null,
    attempts: attempts.length > 1 ? attempts : undefined
  });

  emitProgress(
    emitter,
    makeEvent("security:end", { ...eventBase, stage: "security" }, {
      status: securityOutput.ok ? "ok" : "fail",
      message: securityOutput.ok ? "Security audit passed" : `Security: ${securityOutput.summary}`
    })
  );

  if (!securityOutput.ok) {
    const maxSecurityRetries = config.session?.max_security_retries ?? 1;
    session.security_retry_count = (session.security_retry_count || 0) + 1;
    await saveSession(session);

    if (session.security_retry_count >= maxSecurityRetries) {
      const solomonResult = await invokeSolomon({
        config, logger, emitter, eventBase, stage: "security", askQuestion, session, iteration,
        conflict: {
          stage: "security",
          task,
          diff,
          iterationCount: session.security_retry_count,
          maxIterations: maxSecurityRetries,
          history: [{ agent: "security", feedback: securityOutput.summary }]
        }
      });

      if (solomonResult.action === "pause") {
        return { action: "pause", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "security_fail_fast" } };
      }
      if (solomonResult.action === "subtask") {
        return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "security_subtask" } };
      }
      // Solomon approved — proceed
      return { action: "ok" };
    }

    session.last_reviewer_feedback = `Security feedback: ${securityOutput.summary}`;
    await saveSession(session);
    return { action: "continue" };
  }

  session.security_retry_count = 0;
  return { action: "ok", stageResult: { ok: true, summary: securityOutput.summary || "No vulnerabilities found" } };
}

// Exported for testing
export { buildFallbackChain, isAgentFailure, runRoleWithFallback };

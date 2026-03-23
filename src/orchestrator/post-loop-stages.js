import { TesterRole } from "../roles/tester-role.js";
import { SecurityRole } from "../roles/security-role.js";
import { ImpeccableRole } from "../roles/impeccable-role.js";
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
      return { output, provider, attempts };
    }

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
    // Tester findings are advisory when reviewer already approved.
    // Auto-continue with a warning — no human escalation needed.
    logger.warn(`Tester failed (advisory): ${testerOutput.summary}`);
    emitProgress(
      emitter,
      makeEvent("tester:auto-continue", { ...eventBase, stage: "tester" }, {
        status: "warn",
        message: `Tester issues are advisory (reviewer approved), continuing: ${testerOutput.summary}`,
        detail: { summary: testerOutput.summary, auto_continued: true }
      })
    );
    return { action: "ok", stageResult: { ok: false, summary: testerOutput.summary || "Tester issues (advisory)", auto_continued: true } };
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
    // Check if the security finding is critical (SQL injection, RCE, auth bypass, etc.)
    const summary = (securityOutput.summary || "").toLowerCase();
    const criticalPatterns = ["injection", "rce", "remote code", "auth bypass", "authentication bypass", "privilege escalation", "credentials exposed", "secret", "critical vulnerability"];
    const isCritical = criticalPatterns.some((p) => summary.includes(p));

    if (isCritical) {
      // Critical security issue — escalate to Solomon/human
      logger.warn(`Critical security finding — escalating: ${securityOutput.summary}`);
      const solomonResult = await invokeSolomon({
        config, logger, emitter, eventBase, stage: "security", askQuestion, session, iteration,
        conflict: {
          stage: "security",
          task,
          diff,
          iterationCount: 1,
          maxIterations: 1,
          history: [{ agent: "security", feedback: securityOutput.summary }]
        }
      });

      if (solomonResult.action === "pause") {
        return { action: "pause", result: { paused: true, sessionId: session.id, question: solomonResult.question, context: "security_critical" } };
      }
      if (solomonResult.action === "subtask") {
        return { action: "pause", result: { paused: true, sessionId: session.id, subtask: solomonResult.subtask, context: "security_subtask" } };
      }
      return { action: "ok" };
    }

    // Non-critical security findings are advisory when reviewer already approved.
    logger.warn(`Security failed (advisory): ${securityOutput.summary}`);
    emitProgress(
      emitter,
      makeEvent("security:auto-continue", { ...eventBase, stage: "security" }, {
        status: "warn",
        message: `Security issues are advisory (reviewer approved), continuing: ${securityOutput.summary}`,
        detail: { summary: securityOutput.summary, auto_continued: true }
      })
    );
    return { action: "ok", stageResult: { ok: false, summary: securityOutput.summary || "Security issues (advisory)", auto_continued: true } };
  }

  session.security_retry_count = 0;
  return { action: "ok", stageResult: { ok: true, summary: securityOutput.summary || "No vulnerabilities found" } };
}

export async function runImpeccableStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff }) {
  logger.setContext({ iteration, stage: "impeccable" });
  emitProgress(
    emitter,
    makeEvent("impeccable:start", { ...eventBase, stage: "impeccable" }, {
      message: "Impeccable auditing frontend design quality"
    })
  );

  const impeccable = new ImpeccableRole({ config, logger, emitter });
  await impeccable.init({ task, iteration });
  const impeccableStart = Date.now();
  let impeccableOutput;
  try {
    impeccableOutput = await impeccable.run({ task, diff });
  } catch (err) {
    logger.warn(`Impeccable threw: ${err.message}`);
    impeccableOutput = { ok: false, summary: `Impeccable error: ${err.message}`, result: { error: err.message } };
  }
  trackBudget({
    role: "impeccable",
    provider: config?.roles?.impeccable?.provider || coderRole.provider,
    model: config?.roles?.impeccable?.model || coderRole.model,
    result: impeccableOutput,
    duration_ms: Date.now() - impeccableStart
  });

  await addCheckpoint(session, {
    stage: "impeccable",
    iteration,
    ok: impeccableOutput.ok,
    provider: config?.roles?.impeccable?.provider || coderRole.provider,
    model: config?.roles?.impeccable?.model || coderRole.model || null
  });

  const verdict = impeccableOutput.result?.verdict || "APPROVED";
  emitProgress(
    emitter,
    makeEvent("impeccable:end", { ...eventBase, stage: "impeccable" }, {
      status: impeccableOutput.ok ? "ok" : "fail",
      message: impeccableOutput.ok
        ? (verdict === "IMPROVED" ? "Impeccable applied design fixes" : "Impeccable audit passed")
        : `Impeccable: ${impeccableOutput.summary}`
    })
  );

  // Impeccable is advisory — failures do not block the pipeline
  return { action: "ok", stageResult: { ok: impeccableOutput.ok, verdict, summary: impeccableOutput.summary || "No frontend design issues found" } };
}

// Exported for testing
export { buildFallbackChain, isAgentFailure, runRoleWithFallback };

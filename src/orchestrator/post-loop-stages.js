import { TesterRole } from "../roles/tester-role.js";
import { SecurityRole } from "../roles/security-role.js";
import { ImpeccableRole } from "../roles/impeccable-role.js";
import { AuditRole } from "../roles/audit-role.js";
import { addCheckpoint } from "../session/store.js";
import { resetRetryCount } from "../session/mutators.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { invokeSolomon } from "./solomon-escalation.js";

const KNOWN_AGENTS = ["claude", "codex", "gemini", "copilot", "pi"];

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
async function runRoleWithFallback(RoleClass, { roleName, config, logger, emitter, eventBase, task, iteration, diff, pendingGherkinTests = null, shellTestResults = null }) {
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
      // Tests-first Phase 3: the tester role accepts optional extra
      // inputs. Other roles ignore them harmlessly (they destructure
      // only what they need from the input object).
      output = await role.run({ task, diff, pendingGherkinTests, shellTestResults });
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

export async function runTesterStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff, askQuestion: _askQuestion, pendingGherkinTests = null, shellTestResults = null }) {
  logger.setContext({ iteration, stage: "tester" });
  emitProgress(
    emitter,
    makeEvent("tester:start", { ...eventBase, stage: "tester" }, {
      message: "Tester evaluating test quality",
      detail: { provider: config?.roles?.tester?.provider || config?.roles?.coder?.provider || config?.coder || "claude", executorType: "agent" }
    })
  );

  const testerStart = Date.now();
  const { output: testerOutput, provider, attempts } = await runRoleWithFallback(
    TesterRole,
    {
      roleName: "tester", config, logger, emitter, eventBase, task, iteration, diff,
      // Tests-first Phase 3 (v2.7.5): hand the tester the HU's pending
      // Gherkin scenarios and the upstream shell-test results so it
      // translates and reports accurately instead of re-running the
      // gate or ignoring the behavioural spec.
      pendingGherkinTests,
      shellTestResults,
    }
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

  const testerProvider = provider || coderRole.provider;
  emitProgress(
    emitter,
    makeEvent("tester:end", { ...eventBase, stage: "tester" }, {
      status: testerOutput.ok ? "ok" : "fail",
      message: testerOutput.ok ? "Tester passed" : `Tester: ${testerOutput.summary}`,
      detail: { ok: testerOutput.ok, summary: testerOutput.summary, provider: testerProvider, executorType: "agent" }
    })
  );

  if (!testerOutput.ok) {
    // Tester failed — blocking, return to coder for correction
    logger.warn(`Tester failed (blocking): ${testerOutput.summary}`);
    emitProgress(
      emitter,
      makeEvent("tester:blocking", { ...eventBase, stage: "tester" }, {
        status: "fail",
        message: `Tester failed — sending back to coder for correction: ${testerOutput.summary}`,
        detail: { summary: testerOutput.summary, blocking: true, provider: testerProvider, executorType: "agent" }
      })
    );
    return {
      action: "continue",
      stageResult: { ...testerOutput.result, summary: testerOutput.summary, provider: testerProvider }
    };
  }

  resetRetryCount(session, "tester");
  // Propagate the full tester result (verdict, failing_scenarios,
  // translated_scenarios, coverage…) — not just {ok, summary}. Callers
  // in the HU sub-pipeline read `stageResult.verdict === "pass"` to
  // decide approve-vs-feedback when Gherkin translation is involved;
  // dropping the verdict here forced every Gherkin-bearing HU into the
  // "fail" branch even when the tester explicitly returned pass, which
  // burned all max_iterations and broke the FASE-2 test-diet run.
  return {
    action: "ok",
    stageResult: {
      ...testerOutput.result,
      ok: true,
      summary: testerOutput.summary || "All tests passed",
      provider: testerProvider,
    },
  };
}

export async function runSecurityStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff, askQuestion, brainCtx }) {
  logger.setContext({ iteration, stage: "security" });
  emitProgress(
    emitter,
    makeEvent("security:start", { ...eventBase, stage: "security" }, {
      message: "Security auditing code",
      detail: { provider: config?.roles?.security?.provider || config?.roles?.coder?.provider || config?.coder || "claude", executorType: "agent" }
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

  const securityProvider = provider || coderRole.provider;
  emitProgress(
    emitter,
    makeEvent("security:end", { ...eventBase, stage: "security" }, {
      status: securityOutput.ok ? "ok" : "fail",
      message: securityOutput.ok ? "Security audit passed" : `Security: ${securityOutput.summary}`,
      detail: { ok: securityOutput.ok, summary: securityOutput.summary, provider: securityProvider, executorType: "agent" }
    })
  );

  if (!securityOutput.ok) {
    // Check if the security finding is critical (SQL injection, RCE, auth bypass, etc.)
    const summary = (securityOutput.summary || "").toLowerCase();
    const criticalPatterns = ["injection", "rce", "remote code", "auth bypass", "authentication bypass", "privilege escalation", "credentials exposed", "secret", "critical vulnerability"];
    const isCritical = criticalPatterns.some((p) => summary.includes(p));

    if (isCritical) {
      // Brain: when enabled, skip Solomon — Brain handles via feedback queue
      if (brainCtx?.enabled) {
        logger.warn(`Brain: critical security finding — Brain will handle (Solomon bypassed): ${securityOutput.summary}`);
        const { processRoleOutput } = await import("./brain-coordinator.js");
        processRoleOutput(brainCtx, { roleName: "security", output: { verdict: "fail", summary: securityOutput.summary, critical: true }, iteration });
        emitProgress(emitter, makeEvent("brain:security-critical", { ...eventBase, stage: "security" }, {
          message: `Critical security finding — Brain handling: ${securityOutput.summary.slice(0, 200)}`,
          detail: { summary: securityOutput.summary }
        }));
        return {
          action: "continue",
          stageResult: { ...securityOutput.result, summary: securityOutput.summary, provider: securityProvider }
        };
      }

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

    // Non-critical security findings — blocking, return to coder for correction
    logger.warn(`Security failed (blocking): ${securityOutput.summary}`);
    emitProgress(
      emitter,
      makeEvent("security:blocking", { ...eventBase, stage: "security" }, {
        status: "fail",
        message: `Security failed — sending back to coder for correction: ${securityOutput.summary}`,
        detail: { summary: securityOutput.summary, blocking: true, provider: securityProvider, executorType: "agent" }
      })
    );
    return {
      action: "continue",
      stageResult: { ...securityOutput.result, summary: securityOutput.summary, provider: securityProvider }
    };
  }

  resetRetryCount(session, "security");
  return { action: "ok", stageResult: { ok: true, summary: securityOutput.summary || "No vulnerabilities found" } };
}

export async function runImpeccableStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff, mode = "audit" }) {
  logger.setContext({ iteration, stage: "impeccable" });
  const isRefactoring = mode === "refactoring";
  const startMessage = isRefactoring
    ? "Impeccable applying design refactoring"
    : "Impeccable auditing frontend design quality";
  emitProgress(
    emitter,
    makeEvent("impeccable:start", { ...eventBase, stage: "impeccable" }, {
      message: startMessage,
      detail: { provider: config?.roles?.impeccable?.provider || coderRole.provider, executorType: "agent", mode }
    })
  );

  const impeccable = new ImpeccableRole({ config, logger, emitter, mode });
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
  const impeccableProvider = config?.roles?.impeccable?.provider || coderRole.provider;
  emitProgress(
    emitter,
    makeEvent("impeccable:end", { ...eventBase, stage: "impeccable" }, {
      status: impeccableOutput.ok ? "ok" : "fail",
      message: impeccableOutput.ok
        ? (verdict === "IMPROVED" ? "Impeccable applied design fixes" : "Impeccable audit passed")
        : `Impeccable: ${impeccableOutput.summary}`,
      detail: { provider: impeccableProvider, executorType: "agent" }
    })
  );

  // Impeccable is advisory — failures do not block the pipeline
  return { action: "ok", stageResult: { ok: impeccableOutput.ok, verdict, summary: impeccableOutput.summary || "No frontend design issues found" } };
}

export async function runFinalAuditStage({ config, logger, emitter, eventBase, session, coderRole, trackBudget, iteration, task, diff }) {
  logger.setContext({ iteration, stage: "audit" });
  emitProgress(
    emitter,
    makeEvent("audit:start", { ...eventBase, stage: "audit" }, {
      message: "Final audit — verifying code quality",
      detail: { provider: config?.roles?.audit?.provider || config?.roles?.coder?.provider || config?.coder || "claude", executorType: "agent" }
    })
  );

  const auditStart = Date.now();
  const { output: auditOutput, provider, attempts } = await runRoleWithFallback(
    AuditRole,
    { roleName: "audit", config, logger, emitter, eventBase, task, iteration, diff }
  );
  const totalDuration = Date.now() - auditStart;

  trackBudget({
    role: "audit",
    provider: provider || coderRole.provider,
    model: config?.roles?.audit?.model || coderRole.model,
    result: auditOutput,
    duration_ms: totalDuration
  });

  await addCheckpoint(session, {
    stage: "audit",
    iteration,
    ok: auditOutput.ok,
    provider: provider || coderRole.provider,
    model: config?.roles?.audit?.model || coderRole.model || null,
    attempts: attempts.length > 1 ? attempts : undefined
  });

  const auditProvider = provider || coderRole.provider;
  if (!auditOutput.ok) {
    // Audit agent failed to run — treat as advisory, don't block pipeline
    logger.warn(`Audit agent error (advisory): ${auditOutput.summary}`);
    emitProgress(
      emitter,
      makeEvent("audit:end", { ...eventBase, stage: "audit" }, {
        status: "warn",
        message: `Audit: agent error (advisory), continuing — ${auditOutput.summary}`,
        detail: { provider: auditProvider, executorType: "agent" }
      })
    );
    return { action: "ok", stageResult: { ok: false, summary: auditOutput.summary || "Audit agent error (advisory)", auto_continued: true } };
  }

  // Parse findings from audit result
  const result = auditOutput.result || {};
  const summary = result.summary || {};
  const overallHealth = summary.overallHealth || "fair";
  const criticalCount = summary.critical || 0;
  const highCount = summary.high || 0;

  // Collect critical and high findings for feedback
  const actionableFindings = [];
  if (result.dimensions) {
    for (const [dimName, dim] of Object.entries(result.dimensions)) {
      for (const finding of (dim.findings || [])) {
        if (finding.severity === "critical" || finding.severity === "high") {
          actionableFindings.push({
            dimension: dimName,
            ...finding
          });
        }
      }
    }
  }

  const hasActionableIssues = (overallHealth === "poor" || overallHealth === "critical") && (criticalCount > 0 || highCount > 0);

  if (hasActionableIssues) {
    // Build feedback string for the coder
    const feedbackLines = actionableFindings.map(f => {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
      return `[${f.severity.toUpperCase()}] ${loc} ${f.description}${f.recommendation ? ` — Fix: ${f.recommendation}` : ""}`;
    });
    const feedback = `Audit found ${criticalCount + highCount} critical/high issue(s) that must be fixed:\n${feedbackLines.join("\n")}`;

    logger.warn(`Audit: ${criticalCount + highCount} actionable issues found, sending back to coder`);
    emitProgress(
      emitter,
      makeEvent("audit:end", { ...eventBase, stage: "audit" }, {
        status: "fail",
        message: `Audit: ${criticalCount + highCount} issue(s) found, sending back to coder`,
        detail: { provider: auditProvider, executorType: "agent" }
      })
    );

    return { action: "retry", feedback, stageResult: { ok: false, summary: auditOutput.summary || `${criticalCount + highCount} actionable issues` } };
  }

  // Audit passed (good/fair or no critical/high findings)
  const hasAdvisory = (summary.medium || 0) + (summary.low || 0) > 0;
  const certifiedMsg = hasAdvisory
    ? `Audit: CERTIFIED (with ${(summary.medium || 0) + (summary.low || 0)} advisory warning(s))`
    : "Audit: CERTIFIED";

  logger.info(certifiedMsg);
  emitProgress(
    emitter,
    makeEvent("audit:end", { ...eventBase, stage: "audit" }, {
      status: "ok",
      message: certifiedMsg,
      detail: { provider: auditProvider, executorType: "agent" }
    })
  );

  return { action: "ok", stageResult: { ok: true, summary: certifiedMsg } };
}

// Exported for testing
export { buildFallbackChain, isAgentFailure, runRoleWithFallback };

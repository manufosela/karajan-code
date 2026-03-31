/**
 * Preflight environment checks for kj_run.
 *
 * Runs AFTER policy resolution (so we know which stages are active)
 * and BEFORE session iteration loop (so we fail fast).
 *
 * Design: SonarQube checks are BLOCKING when enabled — if SonarQube is
 * configured but not available, the pipeline STOPS with a clear error.
 * Security agent checks remain graceful (warning, auto-disable).
 */

import { checkBinary } from "../utils/agent-detect.js";
import { isSonarReachable, sonarUp } from "../sonar/manager.js";
import { runCommand } from "../utils/process.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { msg, getLang } from "../utils/messages.js";
import {
  resolveSonarHost,
  resolveSonarToken,
  resolveSonarCredentials,
} from "../sonar/config-resolver.js";
import { withDocLink } from "../utils/doc-links.js";

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch { /* invalid JSON */
    return null;
  }
}

async function checkDocker() {
  const result = await checkBinary("docker");
  return {
    name: "docker",
    ok: result.ok,
    detail: result.ok ? `Docker ${result.version}` : "Docker not found",
  };
}

const SONAR_STARTUP_POLL_MS = 5000;
const SONAR_STARTUP_MAX_WAIT_MS = 60000;

async function waitForSonar(host, maxWaitMs = SONAR_STARTUP_MAX_WAIT_MS) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await isSonarReachable(host)) return true;
    await new Promise(r => setTimeout(r, SONAR_STARTUP_POLL_MS));
  }
  return false;
}

async function checkSonarReachable(host) {
  const reachable = await isSonarReachable(host);
  if (reachable) {
    return { name: "sonar-reachable", ok: true, detail: `SonarQube reachable at ${host}`, remediated: false };
  }

  // Auto-remediation: start SonarQube and wait for it to be ready
  try {
    const upResult = await sonarUp(host);
    if (upResult.exitCode === 0) {
      // SonarQube needs 20-40s to start. Poll until ready.
      if (await waitForSonar(host)) {
        return { name: "sonar-reachable", ok: true, detail: `SonarQube started and reachable at ${host}`, remediated: true };
      }
    }
  } catch {
    // sonarUp failed, fall through
  }

  return { name: "sonar-reachable", ok: false, detail: `SonarQube not reachable at ${host} (auto-start failed after ${SONAR_STARTUP_MAX_WAIT_MS / 1000}s)` };
}

async function checkSonarAuth(config) {
  const host = resolveSonarHost(config.sonarqube?.host);

  // Check explicit token first
  const explicitToken = resolveSonarToken(config);
  if (explicitToken) {
    // Validate the token works
    const res = await runCommand("curl", [
      "-sS", "-o", "/dev/null", "-w", "%{http_code}",
      "-H", `Authorization: Bearer ${explicitToken}`,
      "--max-time", "5",
      `${host}/api/authentication/validate`
    ]);
    if (res.exitCode === 0 && res.stdout.trim().startsWith("2")) {
      return { name: "sonar-auth", ok: true, detail: "Sonar token valid", token: explicitToken };
    }
  }

  // Try admin credentials via centralized resolver
  const { user: adminUser, passwords } = await resolveSonarCredentials(config);

  if (!adminUser || passwords.length === 0) {
    return { name: "sonar-auth", ok: false, detail: "No Sonar token or admin credentials configured. Set KJ_SONAR_TOKEN, configure sonarqube.token in kj.config.yml, or save credentials in ~/.karajan/sonar-credentials.json." };
  }

  for (const password of passwords) {
    const validateRes = await runCommand("curl", [
      "-sS", "-u", `${adminUser}:${password}`,
      `${host}/api/authentication/validate`
    ]);
    if (validateRes.exitCode !== 0) continue;
    const parsed = parseJsonSafe(validateRes.stdout);
    if (!parsed?.valid) continue;

    // Generate a user token
    const tokenName = `karajan-preflight-${Date.now()}`;
    const tokenRes = await runCommand("curl", [
      "-sS", "-u", `${adminUser}:${password}`,
      "-X", "POST",
      "--data-urlencode", `name=${tokenName}`,
      `${host}/api/user_tokens/generate`
    ]);
    if (tokenRes.exitCode !== 0) continue;
    const tokenParsed = parseJsonSafe(tokenRes.stdout);
    if (tokenParsed?.token) {
      return { name: "sonar-auth", ok: true, detail: "Sonar token generated", token: tokenParsed.token };
    }
  }

  return { name: "sonar-auth", ok: false, detail: "Could not validate or generate Sonar token" };
}

async function checkSecurityAgent(config) {
  const provider = config.roles?.security?.provider
    || config.roles?.coder?.provider
    || config.coder
    || "claude";

  const result = await checkBinary(provider);
  return {
    name: "security-agent",
    ok: result.ok,
    detail: result.ok ? `Security agent "${provider}" available (${result.version})` : `Security agent "${provider}" not found`,
    provider,
  };
}

/**
 * Run preflight environment checks.
 *
 * SonarQube checks are BLOCKING: if SonarQube is enabled but not available,
 * ok will be false and errors[] will contain actionable fix instructions.
 * Security agent checks remain graceful (auto-disable via configOverrides).
 *
 * @param {object} opts
 * @param {object} opts.config - Karajan config
 * @param {object} opts.logger - Logger instance
 * @param {object|null} opts.emitter - Event emitter
 * @param {object} opts.eventBase - Base event data
 * @param {object} opts.resolvedPolicies - Output from applyPolicies()
 * @param {boolean} opts.securityEnabled - Whether security stage is enabled
 * @returns {{ ok: boolean, checks: object[], remediations: string[], configOverrides: object, warnings: string[], errors: object[] }}
 */
export async function runPreflightChecks({ config, logger, emitter, eventBase, resolvedPolicies, securityEnabled }) {
  const sonarEnabled = Boolean(config.sonarqube?.enabled) && resolvedPolicies.sonar !== false;
  const isExternalSonar = Boolean(config.sonarqube?.external);
  const sonarHost = resolveSonarHost(config.sonarqube?.host);

  const result = {
    ok: true,
    checks: [],
    remediations: [],
    configOverrides: {},
    warnings: [],
    errors: [],
  };

  // Short-circuit: nothing to check
  if (!sonarEnabled && !securityEnabled) {
    logger.info("Preflight: skipped (no sonar, no security)");
    emitProgress(emitter, makeEvent("preflight:end", { ...eventBase, stage: "preflight" }, {
      message: "Preflight skipped (no checks needed)",
      detail: { ...result, executorType: "local" }
    }));
    return result;
  }

  emitProgress(emitter, makeEvent("preflight:start", { ...eventBase, stage: "preflight" }, {
    message: "Running preflight environment checks",
    detail: { sonarEnabled, securityEnabled, executorType: "local" }
  }));

  // --- 1. Docker (only if sonar enabled and not external) ---
  if (sonarEnabled && !isExternalSonar) {
    const dockerCheck = await checkDocker();
    result.checks.push(dockerCheck);

    emitProgress(emitter, makeEvent("preflight:check", { ...eventBase, stage: "preflight" }, {
      status: dockerCheck.ok ? "ok" : "fail",
      message: `Docker: ${dockerCheck.detail}`,
      detail: dockerCheck
    }));

    if (!dockerCheck.ok) {
      result.ok = false;
      result.errors.push({
        check: "docker",
        message: "Docker not available but SonarQube is enabled.",
        fix: withDocLink("Start Docker, or disable SonarQube: set sonarqube.enabled: false in kj.config.yml, or pass --no-sonar.", "sonar_docker")
      });
      logger.error("Preflight: Docker not found — SonarQube requires Docker");

      // Skip remaining sonar checks, continue to security
      if (!securityEnabled) {
        emitProgress(emitter, makeEvent("preflight:end", { ...eventBase, stage: "preflight" }, {
          status: "fail", message: "Preflight FAILED — environment not ready", detail: result
        }));
        return result;
      }
    }
  }

  // --- 2. SonarQube reachable ---
  if (sonarEnabled && result.ok) {
    const reachableCheck = await checkSonarReachable(sonarHost);
    result.checks.push(reachableCheck);

    if (reachableCheck.remediated) {
      result.remediations.push("SonarQube auto-started via docker compose");
    }

    emitProgress(emitter, makeEvent("preflight:check", { ...eventBase, stage: "preflight" }, {
      status: reachableCheck.ok ? "ok" : "fail",
      message: `SonarQube reachability: ${reachableCheck.detail}`,
      detail: reachableCheck
    }));

    if (!reachableCheck.ok) {
      result.ok = false;
      result.errors.push({
        check: "sonar-reachable",
        message: `SonarQube not reachable at ${sonarHost}.`,
        fix: withDocLink("Start SonarQube: 'docker start karajan-sonarqube', or disable it: set sonarqube.enabled: false in kj.config.yml, or pass --no-sonar.", "sonar_docker")
      });
      logger.error("Preflight: SonarQube not reachable after remediation attempt");
    }
  }

  // --- 3. SonarQube auth/token ---
  if (sonarEnabled && result.ok) {
    const authCheck = await checkSonarAuth(config);
    result.checks.push(authCheck);

    emitProgress(emitter, makeEvent("preflight:check", { ...eventBase, stage: "preflight" }, {
      status: authCheck.ok ? "ok" : "fail",
      message: `SonarQube auth: ${authCheck.detail}`,
      detail: { name: authCheck.name, ok: authCheck.ok, detail: authCheck.detail }
    }));

    if (authCheck.ok && authCheck.token) {
      process.env.KJ_SONAR_TOKEN = authCheck.token;
      result.remediations.push("Sonar token resolved and cached in KJ_SONAR_TOKEN");
      logger.info("Preflight: Sonar token resolved and cached");
    } else if (!authCheck.ok) {
      result.ok = false;
      result.errors.push({
        check: "sonar-auth",
        message: "SonarQube is running but no authentication token is configured.",
        fix: withDocLink("Fix: run 'kj init' to configure it, or set KJ_SONAR_TOKEN env var, or add sonarqube.token to ~/.karajan/kj.config.yml.", "sonar_token")
      });
      logger.error("Preflight: Sonar auth failed");
    }
  }

  // --- 4. Security agent (graceful — only warning, not blocking) ---
  if (securityEnabled) {
    const secCheck = await checkSecurityAgent(config);
    result.checks.push(secCheck);

    emitProgress(emitter, makeEvent("preflight:check", { ...eventBase, stage: "preflight" }, {
      status: secCheck.ok ? "ok" : "warn",
      message: `Security agent: ${secCheck.detail}`,
      detail: secCheck
    }));

    if (!secCheck.ok) {
      result.configOverrides.securityDisabled = true;
      result.warnings.push(`Security agent "${secCheck.provider}" not found — security stage auto-disabled`);
      logger.warn(`Preflight: Security agent "${secCheck.provider}" not found, disabling security stage`);
    }
  }

  const hasErrors = result.errors.length > 0;
  const hasWarnings = result.warnings.length > 0;
  const preflightLang = getLang(config);
  emitProgress(emitter, makeEvent("preflight:end", { ...eventBase, stage: "preflight" }, {
    status: hasErrors ? "fail" : hasWarnings ? "warn" : "ok",
    message: hasErrors
      ? `Preflight FAILED — ${result.errors.length} blocking issue(s)`
      : hasWarnings
        ? `Preflight completed with ${result.warnings.length} warning(s)`
        : msg("preflight_passed", preflightLang),
    detail: { ...result, executorType: "local" }
  }));

  return result;
}

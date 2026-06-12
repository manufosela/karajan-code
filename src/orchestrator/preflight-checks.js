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
import { resolveSonarProjectKey } from "../sonar/project-key.js";
import { runCommand } from "../utils/process.js";
import { emitProgress, makeEvent } from "../utils/events.js";
import { msg, getLang } from "../utils/messages.js";
import {
  resolveSonarHost,
  resolveSonarTokenAsync,
  resolveSonarCredentials,
} from "../sonar/config-resolver.js";
import { saveSonarToken } from "../sonar/credentials.js";
import { withDocLink } from "../utils/doc-links.js";
import { runChecks as runCheckPipeline } from "../checks/runner.js";
import { STATUS } from "../checks/types.js";
import { getNodeChecks } from "../checks/node.js";
import { getDirSetupChecks } from "../checks/dir-setup.js";
import { getPortChecks } from "../checks/ports.js";
import { getTokenChecks } from "../checks/tokens.js";
import { getMcpHealthChecks } from "../checks/mcp-health.js";
import { getSkillsChecks } from "../checks/skills.js";
import { getProjectChecks } from "../checks/project-checks.js";
import { resolveTestHarness } from "../config/test-harness.js";

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

  // Check explicit token first (including persisted tokens from credentials file)
  const explicitToken = await resolveSonarTokenAsync(config);
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
      // Persist the generated token for future sessions
      try { await saveSonarToken(tokenParsed.token); } catch { /* non-blocking */ }
      return { name: "sonar-auth", ok: true, detail: "Sonar token generated and saved", token: tokenParsed.token };
    }
  }

  return { name: "sonar-auth", ok: false, detail: "Could not validate or generate Sonar token" };
}

/**
 * KJC-BUG-0083 — run the real project-key resolver at preflight time so a
 * repo Sonar cannot scan aborts BEFORE the first coder iteration instead
 * of dying in sonar_repeat after burning tokens. Sonar stays mandatory
 * for code tasks (v2.7.4 contract); this only moves the failure earlier.
 */
async function checkSonarProjectKey(config) {
  try {
    const key = await resolveSonarProjectKey(config);
    return { name: "sonar-project-key", ok: true, detail: `Project key resolved: ${key}` };
  } catch (err) {
    return { name: "sonar-project-key", ok: false, detail: err.message };
  }
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
  // Defensive test-harness resolution for direct callers that bypass loadConfig()
  // (notably tests/preflight-checks.test.js and tests/sonar-token-flow.test.js
  // which construct raw configs). Production callers go through loadConfig
  // which already populates config.testHarness once via resolveTestHarness().
  // Idempotent — no-op when already present.
  if (config && !config.testHarness) {
    config.testHarness = resolveTestHarness(config.testHarness);
  }
  // Sonar is intrinsic to Karajan for code tasks (sw/refactor/add-tests).
  // Since v2.7.4 it is NOT toggleable via `config.sonarqube.enabled` —
  // that field is ignored (deprecation warning emitted at config load).
  // The taskType policy (resolved_policies.sonar from DEFAULT_POLICIES in
  // src/guards/policy-resolver.js) is the single source of truth: sw /
  // refactor / add-tests run Sonar, audit / doc / infra / analysis /
  // no-code skip it. Solomon may decide to skip a single iteration via
  // rule alerts — that's a runtime decision, not a config option.
  //
  // Test-harness escape hatch via config.testHarness.disableSonarStage
  // — production code reads `config?.testHarness?.disableSonarStage`,
  // never `globalThis.*`. The legacy `globalThis.__KJ_DISABLE_SONAR_STAGE`
  // shape is documented (and exclusively read) in
  // src/config/test-harness.js, where the loader translates it into
  // the typed config slot above. ESLint rule (#557) blocks any
  // re-introduction outside that one file.
  const sonarStageDisabledForTest = config?.testHarness?.disableSonarStage === true;
  const sonarEnabled = !sonarStageDisabledForTest && resolvedPolicies.sonar !== false;
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

  // Resolve extended preflight opt-in early so the short-circuit below can see it.
  // Post-v2.7.5 this no longer reads globalThis directly — config.testHarness
  // is populated by the loader from the global or the default.
  const extendedDefault = config?.testHarness?.defaultPreflightExtended ?? true;
  const extendedEnabled = config?.preflight?.extended ?? extendedDefault;

  // Preserve legacy short-circuit: if nothing at all needs checking, skip
  // emitting the whole preflight bracket.
  if (!sonarEnabled && !securityEnabled && !extendedEnabled) {
    logger.info("Preflight: skipped (no sonar, no security, extended disabled)");
    emitProgress(emitter, makeEvent("preflight:end", { ...eventBase, stage: "preflight" }, {
      message: "Preflight skipped (no checks needed)",
      detail: { ...result, executorType: "local" }
    }));
    return result;
  }

  emitProgress(emitter, makeEvent("preflight:start", { ...eventBase, stage: "preflight" }, {
    message: "Running preflight environment checks",
    detail: { sonarEnabled, securityEnabled, extendedEnabled, executorType: "local" }
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

  // --- 3b. Sonar project key derivable (KJC-BUG-0083) ---
  // The scanner derives its project key from git remote.origin.url. With
  // an unparseable remote (local-path bare, exotic URL) and no explicit
  // sonarqube.project_key, every iteration's scan threw, the run burned
  // coder tokens and died in sonar_repeat. Run the REAL resolver here —
  // canResolveSonarProjectKey() is weaker (any non-empty remote passes) —
  // so the run fails fast with the actionable message before iteration 1.
  if (sonarEnabled && result.ok) {
    const keyCheck = await checkSonarProjectKey(config);
    result.checks.push(keyCheck);

    emitProgress(emitter, makeEvent("preflight:check", { ...eventBase, stage: "preflight" }, {
      status: keyCheck.ok ? "ok" : "fail",
      message: `Sonar project key: ${keyCheck.detail}`,
      detail: keyCheck
    }));

    if (!keyCheck.ok) {
      result.ok = false;
      result.errors.push({
        check: "sonar-project-key",
        message: "Sonar cannot scan this repository: no project key can be derived.",
        fix: withDocLink("Set sonarqube.project_key in kj.config.yml, or point remote.origin.url at a valid SSH/HTTPS remote.", "sonar_docker")
      });
      logger.error("Preflight: Sonar project key not derivable — failing fast before burning iterations");
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

  // --- 5. Complementary doctor-style checks (Node version, ports, tokens, MCP
  //         health, ~/.karajan dirs, openskills). These are auto-remediated
  //         with yes:true because preflight runs non-interactively inside kj run.
  //         Opt-out via `config.preflight.extended: false`. Defaults to true
  //         in production; the test harness (tests/setup.js) defaults it off.
  if (extendedEnabled) {
    await runExtendedPreflight({ config, result, emitter, eventBase, logger });
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

/**
 * Run the doctor-style complementary checks and merge their outcomes into
 * the existing preflight result shape. Runs with yes:true (non-interactive)
 * and auto-remediation enabled. FAIL/TIMEOUT are appended to errors (blocking),
 * WARN are appended to warnings (non-blocking), FIXED status is recorded as a
 * remediation, and runtime overrides from auto-fixes are merged into
 * configOverrides.
 */
async function runExtendedPreflight({ config, result, emitter, eventBase, logger }) {
  const checks = [
    ...getNodeChecks(),
    ...getDirSetupChecks(),
    ...getPortChecks(),
    ...getTokenChecks(config),
    ...getMcpHealthChecks(),
    ...getSkillsChecks(),
    // KJC-TSK-0393: project-aware checks (signal detection, write perms,
    // tools per signal, .env consistency, gh remote access). Saltables con
    // flag --no-project-checks en kj run.
    ...(config?.flags?.noProjectChecks ? [] : getProjectChecks({ projectDir: config?.projectDir || process.cwd() })),
  ];
  let report;
  try {
    report = await runCheckPipeline(checks, { config }, { mode: "fix", yes: true, timeoutMs: 3000, logger });
  } catch (err) {
    logger.warn(`Preflight: extended checks failed to run (${err.message})`);
    return;
  }

  for (const c of report.checks) {
    result.checks.push({ name: c.name, ok: c.status === STATUS.OK || c.status === STATUS.FIXED || c.status === STATUS.SKIPPED, detail: c.detail });
    const eventStatus = c.status === STATUS.FAIL || c.status === STATUS.TIMEOUT
      ? "fail"
      : c.status === STATUS.WARN
        ? "warn"
        : "ok";
    emitProgress(emitter, makeEvent("preflight:check", { ...eventBase, stage: "preflight" }, {
      status: eventStatus,
      message: `${c.label}: ${c.detail}`,
      detail: { name: c.name, status: c.status, detail: c.detail, fix: c.fix }
    }));
    if (c.status === STATUS.FIXED) {
      result.remediations.push(`${c.label}: ${c.detail}`);
    } else if (c.status === STATUS.FAIL || c.status === STATUS.TIMEOUT) {
      result.ok = false;
      result.errors.push({ check: c.name, message: `${c.label}: ${c.detail}`, fix: c.fix });
    } else if (c.status === STATUS.WARN) {
      result.warnings.push(`${c.label}: ${c.detail}`);
    }
  }

  if (report.overrides && Object.keys(report.overrides).length > 0) {
    Object.assign(result.configOverrides, report.overrides);
  }
}

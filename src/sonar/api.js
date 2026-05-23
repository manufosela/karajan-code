import { runCommand } from "../utils/process.js";
import { withRetry } from "../utils/retry.js";
import { resolveSonarProjectKey } from "./project-key.js";
import { resolveSonarToken } from "./config-resolver.js";
import { filterFalsePositives } from "./issue-filter.js";
import { recoverSonarToken } from "./token-recovery.js";

class SonarApiError extends Error {
  constructor(message, { url, httpStatus, hint } = {}) {
    super(message);
    this.name = "SonarApiError";
    this.url = url;
    this.httpStatus = httpStatus;
    this.hint = hint;
  }
}

function tokenFromConfig(config) {
  return resolveSonarToken(config) || "";
}

function parseHttpResponse(stdout) {
  const lines = stdout.split("\n");
  const httpCode = Number.parseInt(lines.pop(), 10) || 0;
  const body = lines.join("\n");
  return { httpCode, body };
}

async function sonarFetchOnce(config, urlPath, { _retriedAfterRecovery = false, logger = null } = {}) {
  const token = tokenFromConfig(config);
  const url = `${config.sonarqube.host}${urlPath}`;
  const res = await runCommand("curl", ["-s", "-w", "\n%{http_code}", "-u", `${token}:`, url]);

  if (res.exitCode !== 0) {
    const err = new SonarApiError(
      `SonarQube is not reachable at ${config.sonarqube.host}. Check that SonarQube is running ('kj sonar start').`,
      { url, hint: "Run 'kj sonar start' or verify Docker is running." }
    );
    err.httpStatus = 503;
    throw err;
  }

  const { httpCode, body } = parseHttpResponse(res.stdout);

  if (httpCode === 401) {
    // KJC-BUG-0057 (v2.19.2): try to bootstrap a fresh token via the Sonar
    // REST API and retry ONCE. If recovery still fails — or this was already
    // the retry — surface the actionable error like before.
    if (!_retriedAfterRecovery) {
      const recovery = await recoverSonarToken(config, logger);
      if (recovery.ok) {
        return sonarFetchOnce(config, urlPath, { _retriedAfterRecovery: true, logger });
      }
      throw new SonarApiError(
        `SonarQube authentication failed (HTTP 401) and auto-recovery failed: ${recovery.reason}. Regenerate the token manually with 'kj init' or save admin user/password in ~/.karajan/sonar-credentials.json.`,
        { url, httpStatus: 401, hint: "Run 'kj init' to regenerate the SonarQube token, or save admin credentials in ~/.karajan/sonar-credentials.json so Karajan can re-bootstrap automatically." }
      );
    }
    throw new SonarApiError(
      `SonarQube authentication failed (HTTP 401) even after auto-recovery. The newly generated token is also being rejected — the Sonar instance may be in an inconsistent state.`,
      { url, httpStatus: 401, hint: "Inspect the Sonar UI directly; consider 'kj sonar restart'." }
    );
  }

  if (httpCode >= 400) {
    const err = new SonarApiError(
      `SonarQube API returned HTTP ${httpCode} for ${url}.`,
      { url, httpStatus: httpCode }
    );
    err.httpStatus = httpCode;
    throw err;
  }

  return body;
}

async function sonarFetch(config, urlPath) {
  const maxAttempts = config.sonarqube?.max_scan_retries ?? 3;
  return withRetry(
    () => sonarFetchOnce(config, urlPath),
    { maxAttempts, initialBackoffMs: 2000, maxBackoffMs: 15000 }
  );
}

export async function getQualityGateStatus(config, projectKey = null) {
  const effectiveProjectKey = await resolveSonarProjectKey(config, { projectKey });
  const body = await sonarFetch(config, `/api/qualitygates/project_status?projectKey=${effectiveProjectKey}`);

  try {
    const parsed = JSON.parse(body);
    return { ok: true, status: parsed.projectStatus?.status || "ERROR", conditions: parsed.projectStatus?.conditions || [], raw: parsed };
  } catch { /* SonarQube response is not valid JSON */
    return { ok: false, status: "ERROR", conditions: [], raw: body };
  }
}

export async function getOpenIssues(config, projectKey = null) {
  const effectiveProjectKey = await resolveSonarProjectKey(config, { projectKey });
  const body = await sonarFetch(config, `/api/issues/search?projectKeys=${effectiveProjectKey}&statuses=OPEN`);

  let parsedIssues = [];
  let parsedRaw = body;
  try {
    const parsed = JSON.parse(body);
    parsedIssues = parsed.issues || [];
    parsedRaw = parsed;
  } catch { /* SonarQube response is not valid JSON */ }

  // KJC-TSK-0416: pre-filtro de falsos positivos antes de devolver al
  // caller. El coder, audit y scan consumen lo que pasa el filtro;
  // suppressed se devuelve aparte para observabilidad.
  // v2.17.0: accepts both legacy config.sonar.false_positives (no `tool`
  // field, implicit "sonar") and the new generalised config.audit.false_positives.
  const sonarLegacy = (config?.sonar?.false_positives || []).map((r) => ({ tool: "sonar", ...r }));
  const auditRules = (config?.audit?.false_positives || []).filter((r) => (r.tool || "sonar") === "sonar");
  const taggedIssues = parsedIssues.map((i) => ({ ...i, tool: "sonar" }));
  const { kept, suppressed } = filterFalsePositives(taggedIssues, {
    extraRules: [...sonarLegacy, ...auditRules],
    projectRoot: config?.projectDir,
  });

  return {
    total: kept.length,
    issues: kept,
    suppressed,
    raw: parsedRaw,
  };
}

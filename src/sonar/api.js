import { runCommand } from "../utils/process.js";
import { withRetry } from "../utils/retry.js";
import { resolveSonarProjectKey } from "./project-key.js";
import { resolveSonarToken } from "./config-resolver.js";

export class SonarApiError extends Error {
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

async function sonarFetchOnce(config, urlPath) {
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
    throw new SonarApiError(
      `SonarQube authentication failed (HTTP 401). Token may be invalid or expired. Regenerate with 'kj init'.`,
      { url, httpStatus: 401, hint: "Run 'kj init' to regenerate the SonarQube token." }
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

  try {
    const parsed = JSON.parse(body);
    return { total: parsed.total || 0, issues: parsed.issues || [], raw: parsed };
  } catch { /* SonarQube response is not valid JSON */
    return { total: 0, issues: [], raw: body };
  }
}

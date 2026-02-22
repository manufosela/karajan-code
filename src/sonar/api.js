import { runCommand } from "../utils/process.js";
import { resolveSonarProjectKey } from "./project-key.js";

function tokenFromConfig(config) {
  return process.env.KJ_SONAR_TOKEN || config.sonarqube.token || "";
}

export async function getQualityGateStatus(config, projectKey = null) {
  const effectiveProjectKey = await resolveSonarProjectKey(config, { projectKey });
  const token = tokenFromConfig(config);
  const url = `${config.sonarqube.host}/api/qualitygates/project_status?projectKey=${effectiveProjectKey}`;
  const res = await runCommand("curl", ["-s", "-u", `${token}:`, url]);
  if (res.exitCode !== 0) {
    return { ok: false, status: "ERROR", raw: res.stderr || res.stdout };
  }

  try {
    const parsed = JSON.parse(res.stdout);
    return { ok: true, status: parsed.projectStatus?.status || "ERROR", raw: parsed };
  } catch {
    return { ok: false, status: "ERROR", raw: res.stdout };
  }
}

export async function getOpenIssues(config, projectKey = null) {
  const effectiveProjectKey = await resolveSonarProjectKey(config, { projectKey });
  const token = tokenFromConfig(config);
  const url = `${config.sonarqube.host}/api/issues/search?projectKeys=${effectiveProjectKey}&statuses=OPEN`;
  const res = await runCommand("curl", ["-s", "-u", `${token}:`, url]);
  if (res.exitCode !== 0) return { total: 0, issues: [], raw: res.stderr || res.stdout };

  try {
    const parsed = JSON.parse(res.stdout);
    return { total: parsed.total || 0, issues: parsed.issues || [], raw: parsed };
  } catch {
    return { total: 0, issues: [], raw: res.stdout };
  }
}

import os from "node:os";
import { sonarDown, sonarLogs, sonarStatus, sonarUp, isSonarReachable } from "../sonar/manager.js";
import { resolveSonarProjectKey } from "../sonar/project-key.js";
import { runCommand } from "../utils/process.js";

function openBrowserCmd() {
  const platform = os.platform();
  if (platform === "darwin") return "open";
  if (platform === "win32") return "start";
  return "xdg-open";
}

export async function sonarOpenCommand({ config }) {
  const host = config?.sonarqube?.host || "http://localhost:9000";

  if (!(await isSonarReachable(host))) {
    return { ok: false, error: `SonarQube is not reachable at ${host}. Run 'kj sonar start' first.` };
  }

  let projectKey;
  try {
    projectKey = await resolveSonarProjectKey(config);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const url = `${host}/dashboard?id=${projectKey}`;
  await runCommand(openBrowserCmd(), [url]);
  return { ok: true, url };
}

export async function sonarCommand({ action }) {
  if (action === "start") {
    const res = await sonarUp();
    console.log(res.stdout || res.stderr);
    return;
  }

  if (action === "stop") {
    const res = await sonarDown();
    console.log(res.stdout || res.stderr);
    return;
  }

  if (action === "logs") {
    const res = await sonarLogs();
    console.log(res.stdout || res.stderr);
    return;
  }

  const res = await sonarStatus();
  console.log(res.stdout || "stopped");
}

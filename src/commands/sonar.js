import { sonarDown, sonarLogs, sonarStatus, sonarUp } from "../sonar/manager.js";

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

import os from "node:os";
import path from "node:path";

export function getKarajanHome() {
  if (process.env.KJ_HOME) {
    return path.resolve(process.env.KJ_HOME);
  }

  return path.join(os.homedir(), ".karajan");
}

export function getSessionRoot() {
  return path.join(getKarajanHome(), "sessions");
}

export function getSonarComposePath() {
  return path.join(getKarajanHome(), "docker-compose.sonar.yml");
}

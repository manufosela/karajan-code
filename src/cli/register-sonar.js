import { sonarCommand, sonarOpenCommand } from "../commands/sonar.js";
import { loadConfig } from "../config.js";

/**
 * Register the `sonar` parent command and its sub-actions
 * (status / start / stop / logs / open). Kept in its own module
 * because every sub-command shares the same one-liner shape and
 * the only one that needs config is `open`.
 */
export function registerSonar(program) {
  const sonar = program.command("sonar").description("Manage SonarQube container");
  sonar.command("status").action(async () => sonarCommand({ action: "status" }));
  sonar.command("start").action(async () => sonarCommand({ action: "start" }));
  sonar.command("stop").action(async () => sonarCommand({ action: "stop" }));
  sonar.command("logs").action(async () => sonarCommand({ action: "logs" }));
  sonar
    .command("open")
    .description("Open SonarQube dashboard in the browser")
    .action(async () => {
      const { config } = await loadConfig();
      const result = await sonarOpenCommand({ config });
      if (!result.ok) {
        console.error(result.error);
        process.exit(1);
      }
      console.log(`Opened ${result.url}`);
    });
}

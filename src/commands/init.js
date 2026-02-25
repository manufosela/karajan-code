import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfigPath, loadConfig, writeConfig } from "../config.js";
import { sonarUp, checkVmMaxMapCount } from "../sonar/manager.js";
import { exists, ensureDir } from "../utils/fs.js";
import { getKarajanHome } from "../utils/paths.js";

export async function initCommand({ logger }) {
  const karajanHome = getKarajanHome();
  await ensureDir(karajanHome);
  logger.info(`Ensured ${karajanHome} exists`);

  const configPath = getConfigPath();
  const reviewRulesPath = path.resolve(process.cwd(), "review-rules.md");
  const coderRulesPath = path.resolve(process.cwd(), "coder-rules.md");

  const { config, exists: configExists } = await loadConfig();
  if (!configExists) {
    await writeConfig(configPath, config);
    logger.info(`Created ${configPath}`);
  }

  if (!(await exists(reviewRulesPath))) {
    await fs.writeFile(
      reviewRulesPath,
      "# Review Rules\n\n- Focus on security, correctness, and test coverage.\n",
      "utf8"
    );
    logger.info("Created review-rules.md");
  }

  if (!(await exists(coderRulesPath))) {
    const templatePath = path.resolve(import.meta.dirname, "../../templates/coder-rules.md");
    let content;
    try {
      content = await fs.readFile(templatePath, "utf8");
    } catch {
      content = [
        "# Coder Rules",
        "",
        "## File modification safety",
        "",
        "- NEVER overwrite existing files entirely. Always make targeted, minimal edits.",
        "- After each edit, verify with `git diff` that ONLY the intended lines changed.",
        "- Do not modify code unrelated to the task.",
        ""
      ].join("\n");
    }
    await fs.writeFile(coderRulesPath, content, "utf8");
    logger.info("Created coder-rules.md");
  }

  const vmCheck = await checkVmMaxMapCount(os.platform());
  if (!vmCheck.ok) {
    logger.warn(`vm.max_map_count check failed: ${vmCheck.reason}`);
    if (vmCheck.fix) {
      logger.warn(`Fix: ${vmCheck.fix}`);
    }
  }

  const sonar = await sonarUp();
  if (sonar.exitCode !== 0) {
    throw new Error(`Failed to start SonarQube: ${sonar.stderr || sonar.stdout}`);
  }

  logger.info("SonarQube container started");

  logger.info("");
  logger.info("To configure the SonarQube token:");
  logger.info("  1. Open http://localhost:9000");
  logger.info("  2. Log in (default credentials: admin / admin)");
  logger.info("  3. Go to: My Account > Security > Generate Token");
  logger.info("  4. Name: karajan-cli, Type: Global Analysis Token");
  logger.info("  5. Set the token in ~/.karajan/kj.config.yml under sonarqube.token");
  logger.info("     or export KJ_SONAR_TOKEN=\"<your-token>\"");
}

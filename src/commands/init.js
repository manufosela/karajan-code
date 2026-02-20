import fs from "node:fs/promises";
import path from "node:path";
import { getConfigPath, loadConfig, writeConfig } from "../config.js";
import { sonarUp } from "../sonar/manager.js";
import { exists } from "../utils/fs.js";

export async function initCommand({ logger }) {
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

  const sonar = await sonarUp();
  if (sonar.exitCode !== 0) {
    throw new Error(`Failed to start SonarQube: ${sonar.stderr || sonar.stdout}`);
  }

  logger.info("SonarQube container started");
}

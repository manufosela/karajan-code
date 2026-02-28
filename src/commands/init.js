import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfigPath, loadConfig, writeConfig } from "../config.js";
import { sonarUp, checkVmMaxMapCount } from "../sonar/manager.js";
import { exists, ensureDir } from "../utils/fs.js";
import { getKarajanHome } from "../utils/paths.js";
import { detectAvailableAgents } from "../utils/agent-detect.js";
import { createWizard, isTTY } from "../utils/wizard.js";

async function runWizard(config, logger) {
  const agents = await detectAvailableAgents();
  const available = agents.filter((a) => a.available);
  const unavailable = agents.filter((a) => !a.available);

  logger.info("\n=== Karajan Code Setup Wizard ===\n");

  if (available.length === 0) {
    logger.warn("No AI agents detected. Install at least one:");
    for (const agent of unavailable) {
      logger.warn(`  ${agent.name}: ${agent.install}`);
    }
    logger.info("\nGenerating config with defaults (claude). You can change it later in kj.config.yml.\n");
    return config;
  }

  logger.info("Detected agents:");
  for (const agent of available) {
    logger.info(`  OK   ${agent.name} (${agent.version})`);
  }
  for (const agent of unavailable) {
    logger.info(`  MISS ${agent.name}`);
  }
  logger.info("");

  if (available.length === 1) {
    const only = available[0].name;
    logger.info(`Only one agent available: ${only}. Using it for all roles.\n`);
    config.coder = only;
    config.reviewer = only;
    config.roles.coder.provider = only;
    config.roles.reviewer.provider = only;
    return config;
  }

  const wizard = createWizard();
  try {
    const agentOptions = available.map((a) => ({
      label: `${a.name} (${a.version})`,
      value: a.name,
      available: true
    }));

    const coder = await wizard.select("Select default CODER agent:", agentOptions);
    config.coder = coder;
    config.roles.coder.provider = coder;
    logger.info(`  -> Coder: ${coder}`);

    const reviewer = await wizard.select("Select default REVIEWER agent:", agentOptions);
    config.reviewer = reviewer;
    config.roles.reviewer.provider = reviewer;
    logger.info(`  -> Reviewer: ${reviewer}`);

    const enableTriage = await wizard.confirm("Enable triage (auto-classify task complexity)?", false);
    config.pipeline.triage = config.pipeline.triage || {};
    config.pipeline.triage.enabled = enableTriage;
    logger.info(`  -> Triage: ${enableTriage ? "enabled" : "disabled"}`);

    const enableSonar = await wizard.confirm("Enable SonarQube analysis?", true);
    config.sonarqube.enabled = enableSonar;
    logger.info(`  -> SonarQube: ${enableSonar ? "enabled" : "disabled"}`);

    const methodology = await wizard.select("Development methodology:", [
      { label: "TDD (test-driven development)", value: "tdd", available: true },
      { label: "Standard (no TDD enforcement)", value: "standard", available: true }
    ]);
    config.development.methodology = methodology;
    config.development.require_test_changes = methodology === "tdd";
    logger.info(`  -> Methodology: ${methodology}`);

    logger.info("");
  } finally {
    wizard.close();
  }

  return config;
}

export async function initCommand({ logger, flags = {} }) {
  const karajanHome = getKarajanHome();
  await ensureDir(karajanHome);
  logger.info(`Ensured ${karajanHome} exists`);

  const configPath = getConfigPath();
  const reviewRulesPath = path.resolve(process.cwd(), "review-rules.md");
  const coderRulesPath = path.resolve(process.cwd(), "coder-rules.md");

  const { config, exists: configExists } = await loadConfig();
  const interactive = flags.noInteractive !== true && isTTY();

  if (configExists && interactive) {
    const wizard = createWizard();
    try {
      const reconfigure = await wizard.confirm("Config already exists. Reconfigure?", false);
      if (reconfigure) {
        const updated = await runWizard(config, logger);
        await writeConfig(configPath, updated);
        logger.info(`Updated ${configPath}`);
      } else {
        logger.info("Keeping existing config.");
      }
    } finally {
      wizard.close();
    }
  } else if (!configExists && interactive) {
    const updated = await runWizard(config, logger);
    await writeConfig(configPath, updated);
    logger.info(`Created ${configPath}`);
  } else if (!configExists) {
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

  if (config.sonarqube?.enabled !== false) {
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
    logger.info('     or export KJ_SONAR_TOKEN="<your-token>"');
  } else {
    logger.info("SonarQube disabled — skipping container setup.");
  }
}

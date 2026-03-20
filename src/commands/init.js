import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfigPath, loadConfig, writeConfig } from "../config.js";
import { sonarUp, checkVmMaxMapCount } from "../sonar/manager.js";
import { exists, ensureDir } from "../utils/fs.js";
import { getKarajanHome } from "../utils/paths.js";
import { detectAvailableAgents } from "../utils/agent-detect.js";
import { createWizard, isTTY } from "../utils/wizard.js";
import { runCommand } from "../utils/process.js";

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

  const wizard = createWizard();
  try {
    if (available.length === 1) {
      const only = available[0].name;
      logger.info(`Only one agent available: ${only}. Using it for all roles.\n`);
      config.coder = only;
      config.reviewer = only;
      config.roles.coder.provider = only;
      config.roles.reviewer.provider = only;
    } else {
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
    }

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

async function handleConfigSetup({ config, configExists, interactive, configPath, logger }) {
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
}

async function ensureReviewRules(reviewRulesPath, logger) {
  if (await exists(reviewRulesPath)) return;
  await fs.writeFile(
    reviewRulesPath,
    "# Review Rules\n\n- Focus on security, correctness, and test coverage.\n",
    "utf8"
  );
  logger.info("Created review-rules.md");
}

async function ensureCoderRules(coderRulesPath, logger) {
  if (await exists(coderRulesPath)) return;
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

async function setupSonarQube(config, logger) {
  if (config.sonarqube?.enabled === false) {
    logger.info("SonarQube disabled — skipping container setup.");
    return;
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
  logger.info('     or export KJ_SONAR_TOKEN="<your-token>"');
}

async function scaffoldBecariaGateway(config, flags, logger) {
  if (!config.becaria?.enabled && !flags.scaffoldBecaria) return;
  const projectDir = process.cwd();
  const workflowDir = path.join(projectDir, ".github", "workflows");
  await ensureDir(workflowDir);

  const templatesDir = path.resolve(import.meta.dirname, "../../templates/workflows");
  const workflows = ["becaria-gateway.yml", "automerge.yml", "houston-override.yml"];

  for (const wf of workflows) {
    const destPath = path.join(workflowDir, wf);
    if (await exists(destPath)) {
      logger.info(`${wf} already exists — skipping`);
    } else {
      const srcPath = path.join(templatesDir, wf);
      try {
        const content = await fs.readFile(srcPath, "utf8");
        await fs.writeFile(destPath, content, "utf8");
        logger.info(`Created ${path.relative(projectDir, destPath)}`);
      } catch (err) {
        logger.warn(`Could not scaffold ${wf}: ${err.message}`);
      }
    }
  }

  logger.info("");
  logger.info("BecarIA Gateway scaffolded. Next steps:");
  logger.info("  1. Create a GitHub App named 'becaria-reviewer' with pull_request write permissions");
  logger.info("  2. Install the App on your repository");
  logger.info("  3. Add secrets: BECARIA_APP_ID and BECARIA_APP_PRIVATE_KEY");
  logger.info("  4. Push the workflow files and enable 'kj run --enable-becaria'");
}

async function installSkills(logger, interactive) {
  const projectDir = process.cwd();
  const commandsDir = path.join(projectDir, ".claude", "commands");
  const skillsTemplateDir = path.resolve(import.meta.dirname, "../../templates/skills");

  let doInstall = true;
  if (interactive) {
    const wizard = createWizard();
    try {
      doInstall = await wizard.confirm("Install Karajan skills as slash commands (/kj-code, /kj-review, etc.)?", true);
    } finally {
      wizard.close();
    }
  }

  if (!doInstall) {
    logger.info("Skills installation skipped.");
    return;
  }

  await ensureDir(commandsDir);

  let installed = 0;
  try {
    const files = await fs.readdir(skillsTemplateDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const src = path.join(skillsTemplateDir, file);
      const dest = path.join(commandsDir, file);
      if (await exists(dest)) {
        logger.info(`  ${file} already exists — skipping`);
        continue;
      }
      const content = await fs.readFile(src, "utf8");
      await fs.writeFile(dest, content, "utf8");
      installed += 1;
    }
  } catch (err) {
    logger.warn(`Could not install skills: ${err.message}`);
    return;
  }

  if (installed > 0) {
    logger.info(`Installed ${installed} Karajan skill(s) in .claude/commands/`);
    logger.info("Available as slash commands: /kj-run, /kj-code, /kj-review, /kj-test, /kj-security, /kj-discover, /kj-architect, /kj-sonar");
  } else {
    logger.info("All skills already installed.");
  }
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

  await handleConfigSetup({ config, configExists, interactive, configPath, logger });
  await ensureReviewRules(reviewRulesPath, logger);
  await ensureCoderRules(coderRulesPath, logger);
  await installSkills(logger, interactive);

  // Check RTK availability and inform user
  let hasRtk = false;
  try {
    const rtkRes = await runCommand("rtk", ["--version"]);
    hasRtk = rtkRes.exitCode === 0;
  } catch {
    hasRtk = false;
  }
  if (!hasRtk) {
    logger.info("");
    logger.info("RTK (Rust Token Killer) can reduce token usage by 60-90%.");
    logger.info("  Install: brew install rtk && rtk init --global");
  }

  await setupSonarQube(config, logger);
  await scaffoldBecariaGateway(config, flags, logger);
}

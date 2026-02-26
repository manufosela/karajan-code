#!/usr/bin/env node
import { Command } from "commander";
import { applyRunOverrides, loadConfig, validateConfig } from "./config.js";
import { createLogger } from "./utils/logger.js";
import { initCommand } from "./commands/init.js";
import { configCommand } from "./commands/config.js";
import { codeCommand } from "./commands/code.js";
import { reviewCommand } from "./commands/review.js";
import { scanCommand } from "./commands/scan.js";
import { doctorCommand } from "./commands/doctor.js";
import { reportCommand } from "./commands/report.js";
import { planCommand } from "./commands/plan.js";
import { runCommandHandler } from "./commands/run.js";
import { resumeCommand } from "./commands/resume.js";
import { sonarCommand, sonarOpenCommand } from "./commands/sonar.js";

async function withConfig(commandName, flags, fn) {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, flags || {});
  validateConfig(merged, commandName);
  const logger = createLogger(merged.output.log_level);
  await fn({ config: merged, logger, flags });
}

const program = new Command();
program.name("kj").description("Karajan Code CLI").version("0.1.0");

program
  .command("init")
  .description("Initialize config, review rules and SonarQube")
  .action(async () => {
    await withConfig("init", {}, initCommand);
  });

program
  .command("config")
  .description("Show current config")
  .option("--json", "Show as JSON")
  .option("--edit", "Open config in $EDITOR for editing")
  .action(async (flags) => {
    await configCommand(flags);
  });

program
  .command("run")
  .description("Run coder+sonar+reviewer loop")
  .argument("<task>")
  .option("--planner <name>")
  .option("--coder <name>")
  .option("--reviewer <name>")
  .option("--refactorer <name>")
  .option("--planner-model <name>")
  .option("--coder-model <name>")
  .option("--reviewer-model <name>")
  .option("--refactorer-model <name>")
  .option("--enable-planner")
  .option("--enable-refactorer")
  .option("--mode <name>")
  .option("--max-iterations <n>")
  .option("--max-iteration-minutes <n>")
  .option("--max-total-minutes <n>")
  .option("--base-branch <name>")
  .option("--base-ref <ref>")
  .option("--reviewer-fallback <name>")
  .option("--reviewer-retries <n>")
  .option("--auto-commit")
  .option("--auto-push")
  .option("--auto-pr")
  .option("--branch-prefix <prefix>")
  .option("--methodology <name>")
  .option("--no-auto-rebase")
  .option("--no-sonar")
  .option("--pg-task <cardId>", "Planning Game card ID (e.g., KJC-TSK-0042)")
  .option("--pg-project <projectId>", "Planning Game project ID")
  .option("--dry-run", "Show what would be executed without running anything")
  .option("--json", "Output JSON only (no styled display)")
  .action(async (task, flags) => {
    await withConfig("run", flags, async ({ config, logger }) => {
      await runCommandHandler({ task, config, logger, flags });
    });
  });

program
  .command("code")
  .description("Run only coder")
  .argument("<task>")
  .option("--coder <name>")
  .option("--coder-model <name>")
  .action(async (task, flags) => {
    await withConfig("code", flags, async ({ config, logger }) => {
      await codeCommand({ task, config, logger });
    });
  });

program
  .command("review")
  .description("Run only reviewer")
  .argument("<task>")
  .option("--reviewer <name>")
  .option("--reviewer-model <name>")
  .option("--base-ref <ref>")
  .action(async (task, flags) => {
    await withConfig("review", flags, async ({ config, logger }) => {
      await reviewCommand({ task, config, logger, baseRef: flags.baseRef });
    });
  });

program
  .command("scan")
  .description("Run SonarQube scan")
  .action(async () => {
    await withConfig("scan", {}, scanCommand);
  });

program
  .command("doctor")
  .description("Check environment requirements")
  .action(async () => {
    await withConfig("doctor", {}, doctorCommand);
  });

program
  .command("report")
  .description("Show latest session report")
  .option("--list", "List session ids")
  .action(async (flags) => {
    await reportCommand(flags);
  });

program
  .command("plan")
  .description("Generate implementation plan")
  .argument("<task>")
  .option("--planner <name>")
  .option("--planner-model <name>")
  .option("--context <text>", "Additional context for the planner")
  .option("--json", "Output raw JSON plan")
  .action(async (task, flags) => {
    await withConfig("plan", flags, async ({ config, logger }) => {
      await planCommand({ task, config, logger, json: flags.json, context: flags.context });
    });
  });

program
  .command("resume")
  .description("Resume a paused session")
  .argument("<sessionId>")
  .option("--answer <text>", "Answer to the question that caused the pause")
  .option("--json", "Output JSON only")
  .action(async (sessionId, flags) => {
    await withConfig("resume", flags, async ({ config, logger }) => {
      await resumeCommand({ sessionId, answer: flags.answer, config, logger, flags });
    });
  });

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

program.parseAsync().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

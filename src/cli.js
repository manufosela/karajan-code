#!/usr/bin/env node
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
import { rolesCommand } from "./commands/roles.js";
import { agentsCommand } from "./commands/agents.js";
import { discoverCommand } from "./commands/discover.js";
import { triageCommand } from "./commands/triage.js";
import { researcherCommand } from "./commands/researcher.js";
import { architectCommand } from "./commands/architect.js";
import { auditCommand } from "./commands/audit.js";
import { boardCommand } from "./commands/board.js";

import { printUpdateNotice } from "./utils/update-check.js";

const PKG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
const PKG_VERSION = JSON.parse(readFileSync(PKG_PATH, "utf8")).version;

// Non-blocking update check (runs in background, prints after command output)
printUpdateNotice(PKG_VERSION).catch(() => {});

async function withConfig(commandName, flags, fn) {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, flags || {});
  validateConfig(merged, commandName);
  const logger = createLogger(merged.output.log_level);
  await fn({ config: merged, logger, flags });
}

const program = new Command();
program.name("kj").description("Karajan Code CLI").version(PKG_VERSION);

program
  .command("init")
  .description("Initialize config, review rules and SonarQube")
  .option("--no-interactive", "Skip wizard, use defaults (for CI/scripts)")
  .option("--scaffold-becaria", "Scaffold BecarIA Gateway workflow files")
  .action(async (flags) => {
    await withConfig("init", flags, async ({ config, logger }) => {
      await initCommand({ logger, flags });
    });
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
  .option("--enable-reviewer")
  .option("--enable-refactorer")
  .option("--enable-researcher")
  .option("--enable-tester")
  .option("--enable-security")
  .option("--enable-impeccable")
  .option("--enable-triage")
  .option("--enable-discover")
  .option("--enable-architect")
  .option("--plan <planId>", "Plan ID from kj plan. Loads persisted plan context and skips researcher/architect/planner.")
  .option("--enable-hu-reviewer")
  .option("--hu-file <path>", "YAML file with HU stories to certify before coding")
  .option("--enable-serena")
  .option("--mode <name>")
  .option("--max-iterations <n>")
  .option("--max-iteration-minutes <n>")
  .option("--max-total-minutes <n>")
  .option("--base-branch <name>")
  .option("--base-ref <ref>")
  .option("--coder-fallback <name>")
  .option("--reviewer-fallback <name>")
  .option("--reviewer-retries <n>")
  .option("--auto-commit")
  .option("--auto-push")
  .option("--auto-pr")
  .option("--enable-becaria", "Enable BecarIA Gateway (early PR + dispatch comments/reviews)")
  .option("--branch-prefix <prefix>")
  .option("--task-type <type>", "Explicit task type: sw, infra, doc, add-tests, refactor")
  .option("--methodology <name>")
  .option("--no-auto-rebase")
  .option("--no-sonar")
  .option("--enable-sonarcloud", "Enable SonarCloud scan (complementary to SonarQube)")
  .option("--no-sonarcloud")
  .option("--checkpoint-interval <n>", "Minutes between interactive checkpoints (default: 5)")
  .option("--pg-task <cardId>", "Planning Game card ID (e.g., KJC-TSK-0042)")
  .option("--pg-project <projectId>", "Planning Game project ID")
  .option("--auto-simplify", "Auto-simplify pipeline for simple tasks (disable reviewer/tester)")
  .option("--no-auto-simplify", "Force full pipeline regardless of triage level")
  .option("--smart-models", "Enable smart model selection based on triage complexity")
  .option("--no-smart-models", "Disable smart model selection")
  .option("--dry-run", "Show what would be executed without running anything")
  .option("--json", "Output JSON only (no styled display)")
  .option("-q, --quiet", "Show only stage status lines, suppress raw agent output (default)")
  .option("-v, --verbose", "Show full agent output (stream-json, raw lines)")
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
  .option("--session-id <id>", "Show report for a specific session ID")
  .option("--format <type>", "Output format: text|json", "text")
  .option("--trace", "Show chronological trace of all pipeline stages")
  .option("--currency <code>", "Display costs in currency: usd|eur", "usd")
  .option("--pg-task <cardId>", "Filter reports by Planning Game card ID")
  .action(async (flags) => {
    await reportCommand(flags);
  });

program
  .command("roles [subcommand] [role]")
  .description("List pipeline roles or show role template instructions")
  .action(async (subcommand, role) => {
    await withConfig("roles", {}, async ({ config }) => {
      await rolesCommand({ config, subcommand: subcommand || "list", roleName: role });
    });
  });

program
  .command("agents [subcommand] [role] [provider]")
  .description("List or change AI agent assignments per role (e.g. kj agents set coder gemini)")
  .option("--global", "Persist change to kj.config.yml (default for CLI)")
  .action(async (subcommand, role, provider, flags) => {
    await withConfig("agents", {}, async ({ config }) => {
      await agentsCommand({ config, subcommand: subcommand || "list", role, provider, global: flags.global });
    });
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
  .command("discover")
  .description("Analyze task for gaps, ambiguities and missing info")
  .argument("<task>")
  .option("--mode <name>", "Discovery mode: gaps|momtest|wendel|classify|jtbd", "gaps")
  .option("--discover <name>", "Override discover agent")
  .option("--discover-model <name>", "Override discover model")
  .option("--json", "Output raw JSON")
  .action(async (task, flags) => {
    await withConfig("discover", flags, async ({ config, logger }) => {
      await discoverCommand({ task, config, logger, mode: flags.mode, json: flags.json });
    });
  });

program
  .command("triage")
  .description("Classify task complexity and recommend pipeline roles")
  .argument("<task>")
  .option("--triage <name>", "Override triage agent")
  .option("--triage-model <name>", "Override triage model")
  .option("--json", "Output raw JSON")
  .action(async (task, flags) => {
    await withConfig("triage", flags, async ({ config, logger }) => {
      await triageCommand({ task, config, logger, json: flags.json });
    });
  });

program
  .command("researcher")
  .description("Research codebase for a task (files, patterns, constraints)")
  .argument("<task>")
  .option("--researcher <name>", "Override researcher agent")
  .option("--researcher-model <name>", "Override researcher model")
  .action(async (task, flags) => {
    await withConfig("researcher", flags, async ({ config, logger }) => {
      await researcherCommand({ task, config, logger });
    });
  });

program
  .command("architect")
  .description("Design solution architecture (layers, patterns, contracts)")
  .argument("<task>")
  .option("--architect <name>", "Override architect agent")
  .option("--architect-model <name>", "Override architect model")
  .option("--context <text>", "Additional context (e.g. researcher output)")
  .option("--json", "Output raw JSON")
  .action(async (task, flags) => {
    await withConfig("architect", flags, async ({ config, logger }) => {
      await architectCommand({ task, config, logger, context: flags.context, json: flags.json });
    });
  });

program
  .command("audit")
  .description("Analyze codebase health (read-only)")
  .argument("[task]")
  .option("--dimensions <list>", "Comma-separated: security,quality,performance,architecture,testing", "all")
  .option("--json", "Output raw JSON")
  .action(async (task, flags) => {
    await withConfig("audit", flags, async ({ config, logger }) => {
      await auditCommand({ task: task || "Analyze the full codebase", config, logger, dimensions: flags.dimensions, json: flags.json });
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

program
  .command("update")
  .description("Update karajan-code to the latest version from npm")
  .action(async () => {
    const { execaCommand } = await import("execa");
    console.log(`Current version: ${PKG_VERSION}`);
    console.log("Checking for updates...");
    try {
      const { stdout } = await execaCommand("npm view karajan-code version");
      const latest = stdout.trim();
      if (latest === PKG_VERSION) {
        console.log(`Already on the latest version (${PKG_VERSION}).`);
        return;
      }
      console.log(`Updating ${PKG_VERSION} → ${latest}...`);
      await execaCommand("npm install -g karajan-code@latest", { stdio: "inherit" });
      console.log(`Updated to ${latest}. Restart Claude to pick up the new MCP server.`);
    } catch (err) {
      console.error(`Update failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command("board [action]")
  .description("Manage HU Board (start|stop|status|open)")
  .option("--port <number>", "Port (default: 4000)", "4000")
  .action(async (action = "start", opts) => {
    await withConfig("board", opts, async ({ config, logger }) => {
      const port = Number(opts.port) || config.hu_board?.port || 4000;
      await boardCommand({ action, port, logger });
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

try {
  await program.parseAsync();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

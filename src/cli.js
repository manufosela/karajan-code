#!/usr/bin/env node
import path from "node:path";
import { readFileSync } from "node:fs";
import { readFile as fsReadFile } from "node:fs/promises";
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
import {
  planCommand, planGenerateCommand, planListCommand,
  planShowCommand, planReadyCommand, planValidateCommand,
  planDeleteCommand, planAddHuCommand, planRemoveHuCommand,
} from "./commands/plan.js";
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
import { loadPlan } from "./plan/plan-store.js";
import { parseCanvasMarkdown } from "./canvas/parse-md.js";
import { validateCanvas } from "./canvas/validate.js";
import { canvasToTask } from "./canvas/to-flat.js";
import { undoCommand } from "./commands/undo.js";
import { statusCommand } from "./commands/status.js";
import { cleanCommand } from "./commands/clean.js";

import { printUpdateNotice } from "./utils/update-check.js";
import { printWelcomeScreen } from "./utils/welcome.js";

const PKG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
const PKG_VERSION = JSON.parse(readFileSync(PKG_PATH, "utf8")).version;

// Non-blocking update check (runs in background, prints after command output)
printUpdateNotice(PKG_VERSION).catch(() => {});

async function withConfig(commandName, flags, fn) {
  const { config } = await loadConfig();
  const merged = applyRunOverrides(config, flags || {});
  validateConfig(merged, commandName);
  const logger = createLogger(merged.output.log_level);

  // Telemetry: anonymous cli_command event (non-blocking)
  import("./utils/telemetry.js")
    .then(({ sendTelemetryEvent }) => sendTelemetryEvent("cli_command", { command: commandName, version: PKG_VERSION }, merged))
    .catch(() => {});

  await fn({ config: merged, logger, flags });
}

const program = new Command();
program
  .name("kj")
  .description("Karajan Code CLI")
  .version(PKG_VERSION)
  // Tell Commander to surface "did you mean…?" + a help pointer on every
  // CLI error (typo'd subcommand, missing required arg, etc.). Propagates
  // automatically to subcommands.
  .showSuggestionAfterError(true)
  .showHelpAfterError("(usa 'kj --help' para ver los comandos disponibles)")
  // Accept unknown options + extra positional args at the ROOT only.
  // Without these two, typing `kj generate plan --task-file SPEC.md`
  // errors with "unknown option --task-file" or "too many arguments"
  // before the welcome action ever sees that 'generate' wasn't a valid
  // subcommand. With them, both are captured and the welcome action
  // gets a chance to emit a useful "no such command" message. Subcommands
  // keep their own strict checking because both flags are per-command,
  // not inherited.
  .allowUnknownOption(true)
  .allowExcessArguments(true);

program
  .command("init")
  .description("Initialize config, review rules and SonarQube")
  .option("--no-interactive", "Skip wizard, use defaults (for CI/scripts)")
  .option("--scaffold-ci", "Scaffold Karajan CI Gateway workflow files")
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
  .argument("[task]", "Task description (or use --task-file to read from a .md file)")
  .option("--task-file <path>", "Read the task from a file (e.g. .md). Alternative to the positional task argument.")
  .option("-y, --yes", "Skip the cwd confirmation prompt (CI / scripted runs).")
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
  // PR4: launch a single HU (or comma-separated list) instead of the
  // entire plan. The board uses this for the per-HU ▶ button so the
  // user can re-run only a failed HU without restarting the whole
  // plan. Requires --plan to also be set.
  .option("--hu <huIds>", "Comma-separated HU IDs to run. When set, the plan's other HUs are skipped. Requires --plan.")
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
  .option("--enable-ci", "Enable Karajan CI (early PR + dispatch comments/reviews)")
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
  .option("--design", "Activate design refactoring mode (impeccable role applies design changes)")
  .option("--domain <text-or-path>", "Domain knowledge: inline text or path to .md file")
  .option("--skills-mode <mode>", "Skill detection mode: auto|regex|semantic|none (default: auto)")
  .option("--brain <mode>", "Brain decisor: on|off (default: on). When off, only legacy flags drive routing.")
  .option("--skip-role <role...>", "Force one or more roles OFF regardless of triage (e.g. --skip-role tester security)")
  .option("--force-role <role...>", "Force one or more roles ON regardless of triage")
  .option("--dry-run", "Show what would be executed without running anything")
  .option("--json", "Output JSON only (no styled display)")
  .option("-q, --quiet", "Show only stage status lines, suppress raw agent output (default)")
  .option("-v, --verbose", "Show full agent output (stream-json, raw lines)")
  .action(async (task, flags) => {
    await withConfig("run", flags, async ({ config, logger }) => {
      // If `--plan <id>` was passed and the user didn't provide a task
      // argument or --task-file, fall back to the task embedded in the
      // plan JSON. The whole point of `kj plan generate` is that the
      // task is captured once and re-used; forcing the user to repeat
      // --task-file on every run is friction with no upside.
      let effectiveTask = task;
      if (!task && !flags.taskFile && flags.plan) {
        // config.projectDir is only populated post-init; before runFlow
        // it can still be undefined. Plans are stored under cwd, so
        // that's the correct fallback for the lookup.
        const projectDir = config.projectDir || process.cwd();
        const plan = await loadPlan(projectDir, flags.plan);
        if (plan?.task && String(plan.task).trim()) {
          effectiveTask = plan.task;
        }
      }
      const { resolveTaskInput } = await import("./utils/task-file.js");
      const resolvedTask = await resolveTaskInput({ task: effectiveTask, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
      await runCommandHandler({ task: resolvedTask, config, logger, flags });
    });
  });

program
  .command("code")
  .description("Run only coder")
  .argument("[task]", "Task description (or use --task-file)")
  .option("--task-file <path>", "Read the task from a file (e.g. .md)")
  .option("--coder <name>")
  .option("--coder-model <name>")
  .action(async (task, flags) => {
    await withConfig("code", flags, async ({ config, logger }) => {
      const { resolveTaskInput } = await import("./utils/task-file.js");
      const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
      await codeCommand({ task: resolvedTask, config, logger });
    });
  });

program
  .command("review")
  .description("Run only reviewer")
  .argument("[task]", "Task description (or use --task-file)")
  .option("--task-file <path>", "Read the task from a file (e.g. .md)")
  .option("--reviewer <name>")
  .option("--reviewer-model <name>")
  .option("--base-ref <ref>")
  .action(async (task, flags) => {
    await withConfig("review", flags, async ({ config, logger }) => {
      const { resolveTaskInput } = await import("./utils/task-file.js");
      const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
      await reviewCommand({ task: resolvedTask, config, logger, baseRef: flags.baseRef });
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
  .description("Check environment requirements and auto-remediate when possible")
  .option("--check-only", "Detect issues without applying fixes")
  .option("-y, --yes", "Auto-confirm prompts for invasive remediations (CI mode)")
  .option("--json", "Emit machine-readable JSON instead of human output")
  .option("--verbose", "Include fix hints and timing for every check")
  .action(async (flags) => {
    const exitCode = await withConfig("doctor", {}, (ctx) =>
      doctorCommand({
        ...ctx,
        checkOnly: !!flags.checkOnly,
        yes: !!flags.yes,
        json: !!flags.json,
        verbose: !!flags.verbose,
      })
    );
    if (Number.isInteger(exitCode)) process.exit(exitCode);
  });

program
  .command("status")
  .description("Show pipeline dashboard with HU progress")
  .option("-n, --lines <n>", "Max log lines to read", "50")
  .action(async (flags) => {
    await statusCommand({ lines: Number(flags.lines) });
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
  .command("skills [action]")
  .description("Manage the skill cache (actions: list | clear-cache | sync-addyosmani | list-addyosmani)")
  .action(async (action) => {
    const { skillsCommand } = await import("./commands/skills.js");
    const exitCode = await skillsCommand({ action: action || "list" });
    if (Number.isInteger(exitCode)) process.exit(exitCode);
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
  .command("clean")
  .description("Garbage-collect stale plans, sessions and HU batches (dry-run by default)")
  .option("--yes", "Actually delete — without this flag, only prints what would be removed")
  .option("--nuke", "Retention=0 everywhere + wipe HU board DB. \"I want it all gone\"")
  .option("--plan-days <n>", "Keep finalised plans (approved/rejected/executed) for N days (default: 30)")
  .option("--draft-days <n>", "Keep draft plans for N days (default: 60)")
  .option("--session-days <n>", "Keep finalised sessions for N days (default: 7)")
  .option("--hu-days <n>", "Keep HU story batches for N days (default: 14)")
  .action(async (flags) => {
    await cleanCommand({
      yes: Boolean(flags.yes),
      nuke: Boolean(flags.nuke),
      planDays: flags.planDays ? Number(flags.planDays) : undefined,
      draftDays: flags.draftDays ? Number(flags.draftDays) : undefined,
      sessionDays: flags.sessionDays ? Number(flags.sessionDays) : undefined,
      huDays: flags.huDays ? Number(flags.huDays) : undefined,
    });
  });

const plan = program.command("plan").description("Plan management (generate, review, approve, execute)");

plan
  .command("generate", { isDefault: true })
  .description("Generate implementation plan with HUs")
  .argument("[task]", "Task description (or use --task-file)")
  .option("--task-file <path>", "Read the task from a file (e.g. .md)")
  .option("--planner <name>")
  .option("--planner-model <name>")
  .option("--context <text>", "Additional context for the planner")
  .option("--json", "Output raw JSON plan")
  // Tests-first quality knobs (v2.7.5). Default is "thorough":
  // when the planner skips acceptance_tests on some HUs, run a
  // focused synthesizer pass to fill them in. Disable with these
  // flags only if you explicitly want a fast / sketch plan.
  .option("--no-tests-synth", "Skip the tests-synthesizer pass that fills in missing acceptance_tests")
  .option("--no-plan-review", "Skip the high-level plan reviewer pass (gaps / deps / overlap / order)")
  .option("--quick", "Sketch mode — skip every quality pass after the initial planner call")
  .option("--canvas <path>", "Read the SPEC as a REASONS Canvas (.md or .yml). Validates schema + acceptance tests at plan-time. See issue #539.")
  .option("-y, --yes", "Skip the project-name prompt (use the auto-derived default).")
  .option("--no-interactive", "Force non-interactive mode (no prompts, use defaults).")
  .action(async (task, flags) => {
    await withConfig("plan", flags, async ({ config, logger }) => {
      // --canvas: validate the structured spec BEFORE invoking the
      // planner. If schema or acceptance tests don't parse, abort
      // with a clear error pointing at the offending operation +
      // test. This is the bug-class fix for the 2026-04-29
      // jq-as-binding incident.
      if (flags.canvas) {
        let canvasText;
        try {
          canvasText = await fsReadFile(flags.canvas, "utf8");
        } catch (err) {
          throw new Error(`--canvas: cannot read ${flags.canvas}: ${err.message}`);
        }
        let parsed;
        try {
          parsed = parseCanvasMarkdown(canvasText);
        } catch (err) {
          throw new Error(`--canvas: parse error: ${err.message}`);
        }
        const validation = validateCanvas(parsed);
        if (!validation.valid) {
          const lines = ["--canvas: validation failed."];
          if (validation.schemaIssues) {
            lines.push("Schema issues:");
            for (const issue of validation.schemaIssues) {
              lines.push(`  - ${issue.path?.map((p) => p.key).join(".") || "(root)"}: ${issue.message}`);
            }
          }
          if (validation.testIssues) {
            lines.push("Acceptance test issues:");
            for (const issue of validation.testIssues) {
              lines.push(`  - Operation #${issue.operationIndex + 1} "${issue.operationTitle}", test #${issue.testIndex + 1} (${issue.type}, ${issue.kind}):`);
              lines.push(`      ${issue.content}`);
              lines.push(`      → ${issue.error}`);
            }
          }
          throw new Error(lines.join("\n"));
        }
        // Convert Canvas → flat task text the planner can consume.
        // The Norms + Safeguards become explicit constraints; the
        // Operations become a numbered list with their acceptance
        // tests inline. Preserves intent end-to-end.
        const taskFromCanvas = canvasToTask(validation.canvas);
        await planGenerateCommand({ task: taskFromCanvas, config, logger, flags });
        return;
      }
      const { resolveTaskInput } = await import("./utils/task-file.js");
      const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
      await planGenerateCommand({
        task: resolvedTask, config, logger, json: flags.json, context: flags.context,
        flags: {
          noTestsSynth: flags.testsSynth === false,
          noPlanReview: flags.planReview === false,
          quick: Boolean(flags.quick),
          yes: Boolean(flags.yes),
          interactive: flags.interactive,
        },
      });
    });
  });

plan.command("list").description("List all plans").action(async (flags) => {
  await withConfig("plan", flags, async ({ config }) => {
    // TSK-0340: was `await import(...)` — now served by the top-level static import.
    await planListCommand({ config });
  });
});

plan.command("show").description("Show plan details + HUs").argument("<planId>").action(async (planId, flags) => {
  await withConfig("plan", flags, async ({ config }) => {
    await planShowCommand({ config, planId });
  });
});

plan.command("ready").description("Approve plan — certify all HUs").argument("<planId>").action(async (planId, flags) => {
  await withConfig("plan", flags, async ({ config }) => {
    await planReadyCommand({ config, planId });
  });
});

plan.command("validate").description("Validate plan structure").argument("<planId>").action(async (planId, flags) => {
  await withConfig("plan", flags, async ({ config }) => {
    await planValidateCommand({ config, planId });
  });
});

plan.command("delete").description("Delete a plan").argument("<planId>").action(async (planId, flags) => {
  await withConfig("plan", flags, async ({ config }) => {
    await planDeleteCommand({ config, planId });
  });
});

plan.command("add-hu").description("Add HU to plan").argument("<planId>")
  .option("--title <text>", "HU title")
  .option("--type <type>", "Task type: sw|infra|doc|add-tests|refactor|nocode", "sw")
  .option("--deps <ids>", "Comma-separated HU IDs this depends on")
  .option("--scope <text>", "Scope description")
  .action(async (planId, flags) => {
    await withConfig("plan", flags, async ({ config }) => {
      await planAddHuCommand({ config, planId, title: flags.title, type: flags.type, deps: flags.deps, scope: flags.scope });
    });
  });

plan.command("remove-hu").description("Remove HU from plan").argument("<planId>").argument("<huId>").action(async (planId, huId, flags) => {
  await withConfig("plan", flags, async ({ config }) => {
    await planRemoveHuCommand({ config, planId, huId });
  });
});

program
  .command("discover")
  .description("Analyze task for gaps, ambiguities and missing info")
  .argument("[task]", "Task description (or use --task-file)")
  .option("--task-file <path>", "Read the task from a file (e.g. .md)")
  .option("--mode <name>", "Discovery mode: gaps|momtest|wendel|classify|jtbd", "gaps")
  .option("--discover <name>", "Override discover agent")
  .option("--discover-model <name>", "Override discover model")
  .option("--json", "Output raw JSON")
  .action(async (task, flags) => {
    await withConfig("discover", flags, async ({ config, logger }) => {
      const { resolveTaskInput } = await import("./utils/task-file.js");
      const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
      await discoverCommand({ task: resolvedTask, config, logger, mode: flags.mode, json: flags.json });
    });
  });

program
  .command("triage")
  .description("Classify task complexity and recommend pipeline roles")
  .argument("[task]", "Task description (or use --task-file)")
  .option("--task-file <path>", "Read the task from a file (e.g. .md)")
  .option("--triage <name>", "Override triage agent")
  .option("--triage-model <name>", "Override triage model")
  .option("--json", "Output raw JSON")
  .action(async (task, flags) => {
    await withConfig("triage", flags, async ({ config, logger }) => {
      const { resolveTaskInput } = await import("./utils/task-file.js");
      const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
      await triageCommand({ task: resolvedTask, config, logger, json: flags.json });
    });
  });

program
  .command("researcher")
  .description("Research codebase for a task (files, patterns, constraints)")
  .argument("[task]", "Task description (or use --task-file)")
  .option("--task-file <path>", "Read the task from a file (e.g. .md)")
  .option("--researcher <name>", "Override researcher agent")
  .option("--researcher-model <name>", "Override researcher model")
  .action(async (task, flags) => {
    await withConfig("researcher", flags, async ({ config, logger }) => {
      const { resolveTaskInput } = await import("./utils/task-file.js");
      const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
      await researcherCommand({ task: resolvedTask, config, logger });
    });
  });

program
  .command("architect")
  .description("Design solution architecture (layers, patterns, contracts)")
  .argument("[task]", "Task description (or use --task-file)")
  .option("--task-file <path>", "Read the task from a file (e.g. .md)")
  .option("--architect <name>", "Override architect agent")
  .option("--architect-model <name>", "Override architect model")
  .option("--context <text>", "Additional context (e.g. researcher output)")
  .option("--json", "Output raw JSON")
  .action(async (task, flags) => {
    await withConfig("architect", flags, async ({ config, logger }) => {
      const { resolveTaskInput } = await import("./utils/task-file.js");
      const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
      await architectCommand({ task: resolvedTask, config, logger, context: flags.context, json: flags.json });
    });
  });

program
  .command("audit")
  .description("Analyze codebase health (read-only)")
  .argument("[task]", "Task description. If absent, defaults to a full-codebase analysis. Use --task-file to point at a .md.")
  .option("--task-file <path>", "Read the task from a file (e.g. .md)")
  .option("--dimensions <list>", "Comma-separated: security,quality,performance,architecture,testing", "all")
  .option("--json", "Output raw JSON")
  .option("--agent-readiness", "Score the repo for AI-agent readability (llms.txt, SKILL.md coverage, page token budgets, robots allowlist, heading hierarchy). LLM-free; uses [path] or cwd as the audit target. See issue #542.")
  .option("--path <dir>", "Path to audit (used with --agent-readiness; defaults to cwd)")
  .action(async (task, flags) => {
    await withConfig("audit", flags, async ({ config, logger }) => {
      let resolvedTask = task;
      if (flags.taskFile) {
        const { readTaskFile } = await import("./utils/task-file.js");
        resolvedTask = await readTaskFile(flags.taskFile, { projectDir: config.projectDir });
      }
      await auditCommand({
        task: resolvedTask || "Analyze the full codebase",
        config, logger,
        dimensions: flags.dimensions, json: flags.json,
        agentReadiness: Boolean(flags.agentReadiness),
        path: flags.path,
      });
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

program
  .command("undo")
  .description("Revert last pipeline run")
  .option("--hard", "Discard all changes (default: soft reset, keeps changes staged)")
  .action(async (flags) => {
    await withConfig("undo", flags, async ({ logger }) => {
      const result = await undoCommand({ hard: !!flags.hard, logger });
      if (!result.ok) process.exit(1);
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

/**
 * Find subcommands whose name is "close enough" to a typo. Used by the
 * fallback action below so `kj generate plan` suggests `kj plan`. Cheap
 * heuristic — same first letter OR substring match OR Levenshtein ≤ 2 —
 * which is all we need for the small set of commands kj exposes.
 */
function suggestSimilarCommands(bad, known) {
  const lower = bad.toLowerCase();
  const out = new Set();
  for (const name of known) {
    const n = name.toLowerCase();
    if (n.includes(lower) || lower.includes(n)) out.add(name);
    else if (n[0] === lower[0] && Math.abs(n.length - lower.length) <= 2) out.add(name);
    else if (levenshtein(n, lower) <= 2) out.add(name);
  }
  return [...out].slice(0, 3);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) m[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) m[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
}

// Default action — fires when no subcommand matched. Two cases:
//   1. No args at all  → friendly welcome screen (preserved behaviour).
//   2. Args were given → user typed an unknown command. Print a clear
//      error pointing at WHICH word was wrong, suggest a close match,
//      list every valid command, and exit non-zero. Commander's own
//      "unknown option" error never fires for these because we set
//      allowUnknownOption(true) on the root above.
program.action(async (_opts, command) => {
  if (command.args.length > 0) {
    const bad = command.args[0];
    const known = program.commands.map((c) => c.name()).sort();
    process.stderr.write(`error: '${bad}' no es un comando válido de kj\n`);
    const suggestions = suggestSimilarCommands(bad, known);
    if (suggestions.length > 0) {
      const list = suggestions.map((s) => `'${s}'`).join(suggestions.length === 2 ? " o " : ", ");
      process.stderr.write(`\n¿Quisiste decir ${list}?\n`);
    }
    process.stderr.write("\nComandos disponibles:\n");
    for (const c of known) process.stderr.write(`  ${c}\n`);
    process.stderr.write("\nUsa 'kj --help' para más información, o 'kj <comando> --help' para detalles de un subcomando.\n");
    process.exit(1);
  }
  const { config } = await loadConfig().catch(() => ({ config: null }));
  printWelcomeScreen({ version: PKG_VERSION, config });
});

try {
  await program.parseAsync();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

import { discoverCommand } from "../commands/discover.js";
import { triageCommand } from "../commands/triage.js";
import { researcherCommand } from "../commands/researcher.js";
import { architectCommand } from "../commands/architect.js";
import { auditCommand } from "../commands/audit.js";
import { resumeCommand } from "../commands/resume.js";
import { boardCommand } from "../commands/board.js";
import { undoCommand } from "../commands/undo.js";
import { syncCommand } from "../commands/sync.js";
import { cleanCommand } from "../commands/clean.js";
import { withConfig } from "./_shared.js";

/**
 * Register the "meta" / single-role / housekeeping commands: pre-pipeline
 * analysis (discover, triage, researcher, architect, audit), session
 * management (resume, board, undo) and maintenance (update, sync, clean).
 *
 * Note: `triage` lives here (not in pipeline) because it's a single-role
 * analysis command in the same family as discover / researcher /
 * architect / audit, none of which run the full agent loop.
 */
export function registerMeta(program, { pkgVersion }) {
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
      await withConfig(pkgVersion, "discover", flags, async ({ config, logger }) => {
        const { resolveTaskInput } = await import("../utils/task-file.js");
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
      await withConfig(pkgVersion, "triage", flags, async ({ config, logger }) => {
        const { resolveTaskInput } = await import("../utils/task-file.js");
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
      await withConfig(pkgVersion, "researcher", flags, async ({ config, logger }) => {
        const { resolveTaskInput } = await import("../utils/task-file.js");
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
      await withConfig(pkgVersion, "architect", flags, async ({ config, logger }) => {
        const { resolveTaskInput } = await import("../utils/task-file.js");
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
    .option("--no-sonar", "Skip the SonarQube findings collector (faster, less context). Sonar findings are also skipped automatically when SonarQube is unreachable.")
    .option("--report-file <path>", "Write the audit report to disk in addition to stdout. <path> may be a file (extension drives format: .md or .json) or a directory (creates audit-<ISO>.<md|json> inside). $KJ_AUDIT_REPORT_DIR env var is used as default directory if no --report-file is given.")
    .action(async (task, flags) => {
      await withConfig(pkgVersion, "audit", flags, async ({ config, logger }) => {
        let resolvedTask = task;
        if (flags.taskFile) {
          const { readTaskFile } = await import("../utils/task-file.js");
          resolvedTask = await readTaskFile(flags.taskFile, { projectDir: config.projectDir });
        }
        // commander resolves --no-sonar to flags.sonar=false (negation flag).
        // We translate to the explicit `noSonar: true` shape AuditRole expects.
        await auditCommand({
          task: resolvedTask || "Analyze the full codebase",
          config, logger,
          dimensions: flags.dimensions, json: flags.json,
          agentReadiness: Boolean(flags.agentReadiness),
          path: flags.path,
          noSonar: flags.sonar === false,
          reportFile: flags.reportFile || null,
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
      await withConfig(pkgVersion, "resume", flags, async ({ config, logger }) => {
        await resumeCommand({ sessionId, answer: flags.answer, config, logger, flags });
      });
    });

  program
    .command("update")
    .description("Update karajan-code to the latest version from npm")
    .action(async () => {
      // Audit follow-up: was execaCommand (shell parsing). Inputs are
      // constants today, but the project standard since #555 is execa
      // with arg arrays (no shell). Migrated for consistency.
      const { execa } = await import("execa");
      console.log(`Current version: ${pkgVersion}`);
      console.log("Checking for updates...");
      try {
        const { stdout } = await execa("npm", ["view", "karajan-code", "version"]);
        const latest = stdout.trim();
        if (latest === pkgVersion) {
          console.log(`Already on the latest version (${pkgVersion}).`);
          return;
        }
        console.log(`Updating ${pkgVersion} → ${latest}...`);
        await execa("npm", ["install", "-g", "karajan-code@latest"], { stdio: "inherit" });
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
      await withConfig(pkgVersion, "board", opts, async ({ config, logger }) => {
        const port = Number(opts.port) || config.hu_board?.port || 4000;
        await boardCommand({ action, port, logger });
      });
    });

  program
    .command("undo")
    .description("Revert last pipeline run")
    .option("--hard", "Discard all changes (default: soft reset, keeps changes staged)")
    .action(async (flags) => {
      await withConfig(pkgVersion, "undo", flags, async ({ logger }) => {
        const result = await undoCommand({ hard: !!flags.hard, logger });
        if (!result.ok) process.exit(1);
      });
    });

  program
    .command("sync")
    .description("Detect drift between code and the latest plan. Read-only report (issue #540 MVP).")
    .option("--plan <planId>", "Sync against a specific plan instead of the latest")
    .option("--json", "Emit machine-readable JSON instead of human output")
    .action(async (flags) => {
      await withConfig(pkgVersion, "sync", flags, async ({ config, logger }) => {
        await syncCommand({ config, logger, planId: flags.plan, json: flags.json });
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
}

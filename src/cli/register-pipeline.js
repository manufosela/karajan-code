import { initCommand } from "../commands/init.js";
import { ollamaStartCommand, ollamaStopCommand, ollamaStatusCommand, ollamaPullCommand } from "../commands/ollama.js";
import { configCommand } from "../commands/config.js";
import { codeCommand } from "../commands/code.js";
import { reviewCommand } from "../commands/review.js";
import { reviewGateCommand, solomonCommand } from "../commands/review-gate.js";
import { scanCommand } from "../commands/scan.js";
import { installToolsCommand } from "../commands/install-tools.js";
import { doctorCommand } from "../commands/doctor.js";
import { reportCommand } from "../commands/report.js";
import { runCommandHandler } from "../commands/run.js";
import { statusCommand } from "../commands/status.js";
import { loadPlan } from "../plan/plan-store.js";
import { withConfig } from "./_shared.js";

/**
 * Register the "core pipeline" commands: everything the user runs day-to-day
 * to drive the agent loop or inspect its output. Kept together so the
 * shape of the run/code/review trio (and the scan/report/doctor helpers
 * that frame them) lives in one file.
 */
export function registerPipeline(program, { pkgVersion }) {
  program
    .command("init")
    .description("Initialize config, review rules and SonarQube")
    .option("--no-interactive", "Skip wizard, use defaults (for CI/scripts)")
    .option("--scaffold-ci", "Scaffold Karajan CI Gateway workflow files")
    .option("--global", "Save config to ~/.karajan/kj.config.yml (skip the scope wizard)")
    .option("--local", "Save config to ./.karajan/kj.config.yml (skip the scope wizard)")
    .option("--no-ollama", "Skip the RAG embedder bootstrap (Ollama-in-Docker). Useful on modest hardware or when an external embedder will be wired manually")
    .option("--no-rtk", "Skip the RTK auto-install (token savings on Bash outputs). Karajan still runs but burns more tokens")
    .option("--no-squeezr", "Skip the Squeezr auto-install (context compression). Karajan still runs but burns more tokens")
    .option("--no-qmd", "Skip the QMD auto-install + collection registration (semantic wiki over docs/, .reviews/ and plans/)")
    .option("--no-harden", "Skip the quality harness (git hooks, lint/commit config, CI gates, agent guidelines)")
    .option("--json", "Emit a machine-readable summary of what init did (AB-B: for host agents)")
    .action(async (flags) => {
      await withConfig(pkgVersion, "init", flags, async ({ config: _config, logger }) => {
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
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
    .option("--task-file <path>", "Read the task from a file (e.g. .md). Alternative to the positional task argument.")
    .option("-y, --yes", "Skip the cwd confirmation prompt (CI / scripted runs).")
    .option("--non-interactive", "Agents/CI: auto-answer prompts with their safe defaults (warn → continue) and stop with exit code 1 when there is none (fail). Also enabled by KJ_NON_INTERACTIVE=1.")
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
    .option("--enable-perf")
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
    .option("--step", "Pause after each iteration with a report and ask before continuing")
    .option("--parallel <n>", "Concurrent HU lanes for plan runs (default: 1, sequential)")
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
    .option("--skip-spec-review", "Bypass the spec-reviewer pre-pipeline audit")
    .option("--autonomy <level>", "Autonomy level: interactive | assisted | autonomous (default: interactive)")
    .option("--autonomous", "Shortcut for --autonomy autonomous: the Arbiter resolves every gate, no human prompts")
    .option("--no-rag-update", "Skip the pre-run RAG drift check (KJC-TSK-0455). Same as config.rag.autoUpdate.onRun=false.")
    .option("--dry-run", "Show what would be executed without running anything")
    .option("--json", "Output JSON only (no styled display)")
    .option("-q, --quiet", "Show only stage status lines, suppress raw agent output (default)")
    .option("-v, --verbose", "Show full agent output (stream-json, raw lines)")
    .action(async (task, flags) => {
      await withConfig(pkgVersion, "run", flags, async ({ config, logger }) => {
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
        const { resolveTaskInput } = await import("../utils/task-file.js");
        const resolvedTask = await resolveTaskInput({ task: effectiveTask, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
        const res = await runCommandHandler({ task: resolvedTask, config, logger, flags });
        // KJC-TSK-0674 (issue #1289): an aborted run (spec-review cancel,
        // unanswerable non-interactive gate) must be observable by CI.
        if (res?.aborted) process.exitCode = 1;
      });
    });

  program
    .command("autorun")
    .description("Unattended delivery: spec → plan → run all HUs → outcome (defaults to --autonomous)")
    .argument("[task]", "Spec/task description (or use --task-file)")
    .option("--task-file <path>", "Read the spec from a file (e.g. spec.md)")
    .option("--autonomy <level>", "interactive | assisted | autonomous (default: autonomous)")
    .option("--autonomous", "Shortcut for --autonomy autonomous")
    .option("--skip-spec-review", "Bypass the spec-reviewer pre-pipeline audit")
    .action(async (task, flags) => {
      const code = await withConfig(pkgVersion, "autorun", flags, async ({ config, logger }) => {
        const { resolveTaskInput } = await import("../utils/task-file.js");
        const { autorunCommand } = await import("../commands/autorun.js");
        const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
        const res = await autorunCommand({ task: resolvedTask, config, logger, flags });
        return res?.ok ? 0 : 1;
      });
      if (Number.isInteger(code)) process.exit(code);
    });

  program
    .command("code")
    .description("Run only coder")
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
    .option("--task-file <path>", "Read the task from a file (e.g. .md)")
    .option("--coder <name>")
    .option("--coder-model <name>")
    .action(async (task, flags) => {
      await withConfig(pkgVersion, "code", flags, async ({ config, logger }) => {
        const { resolveTaskInput } = await import("../utils/task-file.js");
        const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
        await codeCommand({ task: resolvedTask, config, logger });
      });
    });

  // AB-E (KJC-TSK-0651): third-AI arbitration for the v4 environment.
  program
    .command("solomon")
    .description("Ask a third AI to arbitrate a rejected review verdict (brain ≠ reviewer ≠ solomon)")
    .requiredOption("--position <text>", "Why the brain disagrees with the reviewer")
    .option("--range <range>", "Arbitrate a git range instead of the staged diff")
    .action(async (flags) => {
      await withConfig(pkgVersion, "solomon", flags, async ({ config, logger }) => {
        await solomonCommand({ config, logger, flags });
      });
    });

  program
    .command("review")
    .description("Run only reviewer (--staged/--check: v4 cross-AI gate with recorded verdict)")
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
    .option("--task-file <path>", "Read the task from a file (e.g. .md)")
    .option("--reviewer <name>")
    .option("--reviewer-model <name>")
    .option("--base-ref <ref>")
    .option("--staged", "Review the staged diff with a cross-AI reviewer and record the verdict")
    .option("--check", "Verify the recorded verdict matches the staged diff (exit 0/1, hook-friendly)")
    .option("--range <range>", "Review a git range (e.g. main..HEAD) instead of the staged diff")
    .option("--install-gate", "Enable the pre-commit review gate for this project (creates .karajan/review-gate)")
    .action(async (task, flags) => {
      await withConfig(pkgVersion, "review", flags, async ({ config, logger }) => {
        // ENV-B1 (KJC-TSK-0637): the gate mode records a verdict tied to
        // the exact diff so the pre-commit hook can enforce cross-AI review.
        if (flags.staged || flags.check || flags.range || flags.installGate) {
          await reviewGateCommand({ config, logger, flags: { ...flags, task } });
          return;
        }
        const { resolveTaskInput } = await import("../utils/task-file.js");
        const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
        await reviewCommand({ task: resolvedTask, config, logger, baseRef: flags.baseRef });
      });
    });

  program
    .command("scan")
    .description("Run SonarQube scan")
    .action(async () => {
      await withConfig(pkgVersion, "scan", {}, scanCommand);
    });

  program
    .command("doctor")
    .description("Check environment requirements and auto-remediate when possible")
    .option("--check-only", "Detect issues without applying fixes")
    .option("-y, --yes", "Auto-confirm prompts for invasive remediations (CI mode)")
    .option("--json", "Emit machine-readable JSON instead of human output")
    .option("--verbose", "Include fix hints and timing for every check")
    .option("--project", "Run ONLY project-aware checks (signals, tools per signal, write perms, .env consistency, gh remote access) — useful to validate a specific project before kj run")
    .action(async (flags) => {
      const exitCode = await withConfig(pkgVersion, "doctor", {}, (ctx) =>
        doctorCommand({
          ...ctx,
          checkOnly: !!flags.checkOnly,
          yes: !!flags.yes,
          json: !!flags.json,
          verbose: !!flags.verbose,
          projectOnly: !!flags.project,
        })
      );
      if (Number.isInteger(exitCode)) process.exit(exitCode);
    });

  program
    .command("install-tools")
    .description("Install the tools kj needs (git, agent CLI: claude+codex) plus the external audit tools (semgrep, osv-scanner, lighthouse, docker, sonar) using the package manager available on your system")
    .option("--only <tools>", "Comma-separated subset (e.g. \"semgrep,osv-scanner\"). Bypasses stack-gating.")
    .option("-y, --yes", "Auto-accept all prompts (non-interactive)")
    .option("--dry-run", "Show what would be installed without running anything")
    .action(async (flags) => {
      try {
        const { exitCode } = await installToolsCommand({
          only: flags.only,
          yes: !!flags.yes,
          dryRun: !!flags.dryRun,
        });
        if (Number.isInteger(exitCode)) process.exit(exitCode);
      } catch (err) {
        console.error(`kj install-tools: ${err?.message || err}`);
        process.exit(1);
      }
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

  // KJC-TSK-0437 — `kj ollama [start|stop|status|pull]`
  const ollama = program.command("ollama").description("Manage the RAG embedder container (Ollama-in-Docker)");
  ollama.command("start").description("Start Ollama container").action(async () => {
    await withConfig(pkgVersion, "ollama:start", {}, async ({ config, logger }) => ollamaStartCommand({ config, logger }));
  });
  ollama.command("stop").description("Stop Ollama container").action(async () => {
    await withConfig(pkgVersion, "ollama:stop", {}, async ({ config, logger }) => ollamaStopCommand({ config, logger }));
  });
  ollama.command("status").description("Report Ollama reachability + container").action(async () => {
    await withConfig(pkgVersion, "ollama:status", {}, async ({ config, logger }) => ollamaStatusCommand({ config, logger }));
  });
  ollama.command("pull <model>").description("Pull a model into the Ollama container").action(async (model) => {
    await withConfig(pkgVersion, "ollama:pull", {}, async ({ config, logger }) => ollamaPullCommand({ model, config, logger }));
  });
}

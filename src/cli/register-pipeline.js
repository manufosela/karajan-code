import { initCommand } from "../commands/init.js";
import { ollamaStartCommand, ollamaStopCommand, ollamaStatusCommand, ollamaPullCommand } from "../commands/ollama.js";
import { configCommand } from "../commands/config.js";
import { checkSecretsCommand } from "../config/secrets.js";
import { codeCommand } from "../commands/code.js";
import { retire } from "./retired-commands.js";
import { tournamentCommand } from "../commands/tournament.js";
import { resolveTaskInput } from "../utils/task-file.js";
import { reviewGateCommand, solomonCommand } from "../commands/review-gate.js";
import { scanCommand } from "../commands/scan.js";
import { installToolsCommand } from "../commands/install-tools.js";
import { doctorCommand } from "../commands/doctor.js";
import { reportCommand } from "../commands/report.js";
import { withConfig } from "./_shared.js";
import { publishPrReview } from "../review/publish-pr.js";
import { verifyPrReview } from "../review/verify-pr.js";
import { thirdPartyReviewCommand } from "../review/third-party-review.js";

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
    .option("--rulesync", "Adopt rulesync without asking (rulesync init + import; kj's rules move to .rulesync/rules/karajan.md)")
    .option("--no-rulesync", "Do not adopt rulesync; kj keeps writing its rules into CLAUDE.md/AGENTS.md")
    .option("--no-sonar", "Do not start the SonarQube container (Docker). The review gate still needs it: start it later with 'kj sonar start'")
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
    .option("--check-secrets <file>", "Exit 1 when a project kj.config.yml (or - for stdin) holds a secret (ADR 0032)")
    .action(async (flags) => {
      if (flags.checkSecrets) return checkSecretsCommand(flags.checkSecrets);
      await configCommand(flags);
    });

  program
    .command("code")
    .description("Have the coder declared in your panel write (--agent, --card)")
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
    .option("--task-file <path>", "Read the task from a file (e.g. .md)")
    .option("--coder <name>")
    // KJC-TSK-0864: --coder is the pipeline's word for it, --agent is the
    // session's. Same knob, two vocabularies; naming both and disagreeing is
    // an error, never a silent precedence.
    .option("--agent <name>", "The agent that writes (alias of --coder)")
    .option("--card <ref>", "Card/HU the work belongs to — its statement and criteria reach the coder")
    .option("--coder-model <name>")
    .action(async (task, flags) => {
      if (flags.agent && flags.coder && flags.agent !== flags.coder) {
        console.error(`kj code: --agent ${flags.agent} and --coder ${flags.coder} name different agents — pick one`);
        process.exit(2);
      }
      if (flags.agent) flags.coder = flags.agent;
      await withConfig(pkgVersion, "code", flags, async ({ config, logger }) => {
        const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
        await codeCommand({ task: resolvedTask, config, logger, flags });
      });
    });

  // AB-E (KJC-TSK-0651): third-AI arbitration for the v4 environment.
  program
    .command("solomon")
    .description("Ask a third AI to arbitrate a rejected review verdict (brain ≠ reviewer ≠ solomon)")
    .option("--position <text>", "Why the brain disagrees with the reviewer")
    .option("--position-file <path>", "Read the position from a file (no quoting to get right)")
    .option("--range <range>", "Arbitrate a git range instead of the staged diff")
    .action(async (flags) => {
      await withConfig(pkgVersion, "solomon", flags, async ({ config, logger }) => {
        await solomonCommand({ config, logger, flags });
      });
    });

  // KJC-TSK-0723 (TOR-A) — the governed tournament: same task, N coders,
  // isolated lanes; the method picks the winner (TOR-B/C), not vibes.
  program
    .command("tournament")
    .description("Fan the SAME task out to N coders in isolated worktree lanes and collect per-lane evidence (diff, suite, log)")
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
    .option("--task-file <path>", "Read the task from a file (e.g. .md)")
    .option("--coders <csv>", "Comma-separated coder agents (minimum 2), e.g. claude,codex,agy")
    .option("--score <id>", "Score an EXISTING tournament from its artifacts (deterministic, zero LLM)")
    .option("--judge <id>", "Cross-AI judge ranks the finalists (scoreboard in sight; solomon on tie/dispute)")
    .option("--crown <id>", "Commit the judged winner in its lane THROUGH the real review gate")
    .option("--card <ref>", "With --crown: card reference for the commit message (card-first gates)")
    .option("--json", "With --score/--judge/--crown: emit stable JSON")
    .action(async (task, flags) => {
      await withConfig(pkgVersion, "tournament", flags, async ({ config, logger }) => {
        if (flags.score || flags.judge || flags.crown) {
          await tournamentCommand({ task: "", config, logger, flags });
          return;
        }
        const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });
        await tournamentCommand({ task: resolvedTask, config, logger, flags });
      });
    });

  program
    .command("review")
    .description("Cross-AI review gate: --staged/--check/--range record a verdict tied to the exact diff")
    .argument("[task]", "What the change does, for the reviewer (optional; or via --task-file)")
    .option("--task-file <path>", "Read the task from a file (e.g. .md)")
    .option("--reviewer <name>")
    .option("--reviewer-model <name>")
    .option("--base-ref <ref>")
    .option("--staged", "Review the staged diff with a cross-AI reviewer and record the verdict")
    .option("--check", "Verify the recorded verdict matches the staged diff (exit 0/1, hook-friendly)")
    .option("--range <range>", "Review a git range (e.g. main..HEAD) instead of the staged diff")
    .option("--install-gate", "Enable the pre-commit review gate for this project (creates .karajan/review-gate)")
    .option("--prune", "Garbage-collect verdicts in .karajan/reviews older than the TTL (they age out as diffs change)")
    .option("--prune-days <n>", "TTL in days for --prune (default: 14)")
    .option("--dry-run", "With --prune: report what would be removed without deleting")
    .option("--no-sonar", "Skip the deterministic Sonar pre-gate that runs before the cross-AI verdict")
    // BOOT-D (KJC-TSK-0863): how the walkthrough gets INTO the verdict. Without
    // this the rule could only complain, which is the gate with no exit.
    .option("--walked <route>", "Recorrido comprobado como lo haría una persona (repetible) — queda en el veredicto", (v, prev) => [...(prev || []), v], [])
    .option("--walked-with <tool>", "Con qué se comprobó el recorrido (por ejemplo chrome-devtools)")
    .option("--publish-pr <n>", "Publish the cross-AI verdicts of a PR's commits on it as one GitHub review")
    .option("--verify-pr <n>", "CI check: every commit of the PR is listed, with its diff hash, in the kj review a member published")
    .option("--third-party", "Review someone else's PR (--range base...head): reviewer only, no own-work gates, no verdict stored")
    .option("--json", "With --third-party: print the review as one JSON document on stdout")
    .option("--lens <lens>", "With --third-party: what the reviewer looks at; qa = test coverage, weak assertions, flakiness, test data")
    .option("--verifier <provider>", "With --third-party: an AI of another family confirms, downgrades or rejects each finding (#2369)")
    .option("--verifier-model <model>", "With --verifier: the verifier's model")
    .option("--reviewers <a,b>", "With --third-party: two reviewers of different families review on their own and verify each other (#2623)")
    .option("--reviewer-models <a=model,b=model>", "With --reviewers: each reviewer's model")
    .action(async (task, flags) => {
      await withConfig(pkgVersion, "review", flags, async ({ config, logger }) => {
        if ((flags.verifier || flags.verifierModel || flags.reviewers || flags.reviewerModels) && !flags.thirdParty) {
          logger.error("--verifier, --verifier-model, --reviewers and --reviewer-models work with --third-party only");
          process.exitCode = 1;
          return;
        }
        // KJC-TSK-1075 (#2227): a third-party PR, for reviewer agents; own work keeps every gate.
        if (flags.thirdParty) {
          process.exitCode = await thirdPartyReviewCommand({ flags: { ...flags, task: task ?? null }, config });
          return;
        }
        // KJC-TSK-0913: the verdicts kj already holds, published on the PR as one review.
        if (flags.publishPr) {
          const r = await publishPrReview({ projectDir: config.projectDir || process.cwd(), pr: flags.publishPr });
          logger.info(r.published ? `✓ PR #${flags.publishPr}: review published (${r.commits} commit(s))` : `PR #${flags.publishPr}: ${r.reason}`);
          return;
        }
        // KJC-TSK-1088: the CI side of the same review; a commit without its verdict fails the check.
        if (flags.verifyPr) {
          const r = await verifyPrReview({ projectDir: config.projectDir || process.cwd(), pr: flags.verifyPr });
          if (r.ok) logger.info(`✓ PR #${flags.verifyPr}: ${r.commits} commit(s), each with its cross-AI verdict`);
          else logger.error(`✗ PR #${flags.verifyPr}:\n  - ${r.problems.join("\n  - ")}`);
          if (r.sealCommits) logger.info(`  seal commit(s) signed by the roster, a human act with no AI verdict: ${r.sealCommits.join(", ")}`);
          process.exitCode = r.ok ? 0 : 1;
          return;
        }
        // ENV-B1 (KJC-TSK-0637): the gate mode records a verdict tied to
        // the exact diff so the pre-commit hook can enforce cross-AI review.
        if (flags.staged || flags.check || flags.range || flags.installGate || flags.prune) {
          // KJC-BUG-0349: the gate's task is optional, but --task-file carries
          // the evidence the reviewer must weigh; it was never read here.
          const gateTask = task || flags.taskFile
            ? await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger })
            : task;
          await reviewGateCommand({ config, logger, flags: { ...flags, task: gateTask } });
          return;
        }
        retire("review");
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

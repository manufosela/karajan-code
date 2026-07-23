import { discoverCommand } from "../commands/discover.js";
import { triageCommand } from "../commands/triage.js";
import { researcherCommand } from "../commands/researcher.js";
import { architectCommand } from "../commands/architect.js";
import { onboardCommand } from "../commands/onboard.js";
import { startCommand } from "../commands/start.js";
import { ragIndexCommand, ragQueryCommand, ragInstallHooksCommand, ragEvalCommand } from "../commands/rag.js";
import { qmdQueryCommand } from "../commands/qmd.js";
import { ragMcpCommand } from "../commands/rag-mcp.js";
import { watchStartCommand, watchStopCommand, watchStatusCommand } from "../commands/watch.js";
import { auditCommand } from "../commands/audit.js";
import { resumeCommand } from "../commands/resume.js";
import { boardCommand } from "../commands/board.js";
import { webperfCommand } from "../commands/webperf.js";
import { undoCommand } from "../commands/undo.js";
import { syncCommand } from "../commands/sync.js";
import { cleanCommand } from "../commands/clean.js";
import { checkCommand } from "../commands/check.js";
import { mutateCommand } from "../commands/mutate.js";
import { hardenCommand } from "../commands/harden.js";
import { telemetryPreviewCommand, telemetryStatusCommand } from "../commands/telemetry.js";
import { envInstallCommand, briefCommand } from "../commands/env.js";
import { agentRunCommand } from "../commands/agent-run.js";
import { reportIssueCommand } from "../commands/report-issue.js";
import { huCommand } from "../commands/hu.js";
import { worktreeCommand } from "../commands/worktree.js";
import { addAdr, listAdrs } from "../environment/adr.js";
import { formatAdvancedIndex } from "../commands/advanced.js";
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
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
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
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
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
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
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
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
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
    .command("onboard")
    .description("Analyze an existing codebase (brownfield) and produce an Architecture Brief")
    .option("--no-synth", "Skip the LLM synthesis step, dump raw collectors only")
    .option("--output <path>", "Override the default ~/.karajan/onboarding/<slug>.md target")
    .action(async (flags) => {
      await withConfig(pkgVersion, "onboard", flags, async ({ config, logger }) => {
        await onboardCommand({ config, logger, flags });
      });
    });

  program
    .command("start")
    .description("Single entry point: assess the project and recommend the next step")
    .argument("[task]", "What you want to do (optional natural-language goal)")
    .option("--maturity <type>", "Declare project maturity: new|existing|legacy")
    .option("--yes", "Non-interactive: emit assessment + recommendation, apply nothing")
    .option("--json", "Output the assessment + decision as JSON")
    .action(async (task, flags) => {
      await withConfig(pkgVersion, "start", flags, async ({ config, logger }) => {
        await startCommand({ task, config, logger, flags });
      });
    });

  // ENV-A1 (KJC-TSK-0639) — Karajan Environment v4: the host agent
  // orchestrates, Karajan installs the method it must follow.
  const env = program.command("env").description("Karajan Environment (v4) — playbook for host agents");
  env.command("install")
    .description("Install/refresh the Karajan playbook for any host agent (CLAUDE.md, AGENTS.md, GEMINI.md)")
    .option("--target <target>", "claude | codex | gemini | all", "all")
    .option("--no-rag", "Skip building the RAG index when the project has none (ENV-E1)")
    .action(async (flags) => {
      await withConfig(pkgVersion, "env-install", flags, async ({ config, logger }) => {
        const r = await envInstallCommand({ config, logger, flags });
        // KJC-TSK-0659: exit 3 = pending user action (RAG cannot index) —
        // a driving agent must stop and wait, never continue degraded.
        if (Number.isInteger(r?.exitCode) && r.exitCode !== 0) process.exit(r.exitCode);
      });
    });

  // AB-D (KJC-TSK-0654): the brain's inter-agent bus.
  const agentCmd = program.command("agent").description("Delegate work to another AI agent (the brain's bus)");
  agentCmd.command("run <agent> <task>")
    .description("Run a task on the named agent and print its output (exit 0/1)")
    .option("--json", "Machine-readable output: {ok, agent, output, usage}")
    .option("--timeout-minutes <n>", "Hard timeout for the delegated task")
    .action(async (agent, task, flags) => {
      await withConfig(pkgVersion, "agent-run", flags, async ({ config, logger }) => {
        await agentRunCommand({ agent, task, config, logger, flags });
      });
    });

  // AB-H (KJC-TSK-0658): board writes + repo ADRs for the brain.
  // KJC-TSK-0679: isolated lanes for the host agent — ordering a command
  // beats ordering a practice an agent can narrate without doing.
  const wt = program.command("worktree").description("Isolated task lanes (git worktrees) for the host agent");
  wt.command("start <slug>")
    .description("Create a lane: worktree + feat/<slug> branch + dependency bootstrap")
    .action(async (slug, flags) => {
      await withConfig(pkgVersion, "worktree", flags, async ({ config }) => {
        await worktreeCommand({ config, action: "start", args: [slug], flags });
      });
    });
  wt.command("list")
    .description("List the active lanes")
    .action(async (flags) => {
      await withConfig(pkgVersion, "worktree", flags, async ({ config }) => {
        await worktreeCommand({ config, action: "list", flags });
      });
    });
  wt.command("done <slug>")
    .option("--force", "Remove the lane even with uncommitted changes")
    .description("Remove a merged lane (refuses uncommitted changes without --force)")
    .action(async (slug, flags) => {
      await withConfig(pkgVersion, "worktree", flags, async ({ config }) => {
        await worktreeCommand({ config, action: "done", args: [slug], flags });
      });
    });

  const hu = program.command("hu").description("Track work in the HU Board from any host agent (card first)");
  hu.command("add <title>")
    .option("--id <shortId>", "Human-readable short id")
    .option("--ac <criterion>", "Acceptance criterion (repeatable; multiline strings split per line)", (v, acc) => [...acc, v], [])
    .option("--tests <test>", "Acceptance test (repeatable; multiline strings split per line)", (v, acc) => [...acc, v], [])
    .option("--scope <text>", "Scope of the story (files/areas)")
    .option("--task-type <type>", "sw | infra | doc | add-tests | refactor")
    .option("--criteria <text>", "Legacy alias for a single acceptance criterion")
    .option("--json", "Machine-readable output")
    .action(async (title, flags) => {
      await withConfig(pkgVersion, "hu", flags, async ({ config }) => {
        await huCommand({ config, action: "add", args: [title], flags });
      });
    });
  hu.command("move <id> <status>")
    .option("--json", "Machine-readable output")
    .action(async (id, status, flags) => {
      await withConfig(pkgVersion, "hu", flags, async ({ config }) => {
        await huCommand({ config, action: "move", args: [id, status], flags });
      });
    });
  hu.command("list")
    .option("--json", "Machine-readable output")
    .action(async (flags) => {
      await withConfig(pkgVersion, "hu", flags, async ({ config }) => {
        await huCommand({ config, action: "list", flags });
      });
    });

  const adr = program.command("adr").description("Architecture decision records in .karajan/adrs/ (git-tracked)");
  adr.command("add <title>")
    .requiredOption("--decision <text>", "The decision itself")
    .option("--context <text>", "Why this came up")
    .option("--consequences <text>", "Trade-offs accepted")
    .option("--json", "Machine-readable output")
    .action(async (title, flags) => {
      await withConfig(pkgVersion, "adr", flags, async ({ config }) => {
        const res = await addAdr(config?.projectDir || process.cwd(), { title, ...flags });
        console.log(flags.json ? JSON.stringify(res) : `✓ ADR ${res.number} created: ${res.file} — commit it`);
      });
    });
  adr.command("list")
    .option("--json", "Machine-readable output")
    .action(async (flags) => {
      await withConfig(pkgVersion, "adr", flags, async ({ config }) => {
        const adrs = await listAdrs(config?.projectDir || process.cwd());
        if (flags.json) { console.log(JSON.stringify(adrs)); return; }
        for (const a of adrs) console.log(`${String(a.number).padStart(4, "0")}  ${a.status.padEnd(10)} ${a.title}`);
        if (adrs.length === 0) console.log("no ADRs yet — create one with: kj adr add \"<title>\" --decision \"...\"");
      });
    });

  // AB-F (KJC-TSK-0655): self-healing — the brain files kj frictions upstream.
  program
    .command("report-issue")
    .description("Report a kj bug/friction to the public repo (sanitized; publishing needs --publish)")
    .requiredOption("--title <text>", "One-line summary")
    .option("--description <text>", "What happened and what you expected")
    .option("--command <cmd>", "The kj command involved")
    .option("--error <text>", "The error output (it will be sanitized)")
    .option("--publish", "Create the issue via the gh CLI (confirm with your user first)")
    .option("--force", "Skip the similar-issues check")
    .option("--json", "Machine-readable output")
    .action(async (flags) => {
      await reportIssueCommand({ logger: console, flags });
    });

  // AB-C (KJC-TSK-0652): role briefs for the brain (any host agent).
  program
    .command("brief")
    .description("Show the distilled method of a pipeline role (for the host agent to execute)")
    .argument("[role]", "triage | planner | researcher | architect | tester | security | audit")
    .option("--json", "Machine-readable output")
    .action(async (role, flags) => {
      await withConfig(pkgVersion, "brief", flags, async ({ config }) => {
        briefCommand({ config, flags, role });
      });
    });

  const rag = program.command("rag").description("Retrieval-augmented search over Karajan plans, onboarding briefs and project code");
  rag.command("index")
    .description("Index plans + onboarding (and optionally project sources) into the local vector store")
    .option("--with-sources", "Also index the projectDir's JS/TS files")
    .option("--since <ref>", "Only re-index files changed since <ref> ('auto' uses the last indexed commit; falls back to full index if unset). KJC-TSK-0455.")
    .option("--json", "Output the totals as JSON")
    .action(async (flags) => {
      await withConfig(pkgVersion, "rag-index", flags, async ({ config, logger }) => {
        await ragIndexCommand({ config, logger, flags });
      });
    });
  rag.command("install-hooks")
    .description("Install the post-merge git hook so the RAG index auto-refreshes after pulls/merges (KJC-TSK-0455)")
    .option("--json", "Output the result as JSON")
    .action(async (flags) => {
      await withConfig(pkgVersion, "rag-install-hooks", flags, async ({ config, logger }) => {
        await ragInstallHooksCommand({ config, logger, flags });
      });
    });
  rag.command("query <text>")
    .description("Run a semantic query against the indexed RAG corpus")
    .option("--no-rag-update", "Skip the pre-query drift delta-update (ENV-E1)")
    .option("--scope <scope>", "plans | code | onboarding | all (default: all)", "all")
    .option("--top-k <n>", "Number of hits to return (default: 5)", "5")
    .option("--project <slug>", "Filter by project slug. Pass 'all' to query across every indexed project. Default: cwd basename")
    // KJC-BUG-0070 — the global `--mode` flag maps to `review_mode` in
    // src/config/overrides.js. We expose the rag-specific knob under
    // `--rag-mode` to avoid the collision (which crashed the command on
    // first call). Internally we rebind to `flags.mode` so the handler
    // in src/commands/rag.js stays untouched.
    .option("--rag-mode <mode>", "hybrid (default) | semantic (cosine only) | keyword (BM25 only)", "hybrid")
    .option("--alpha <n>", "Hybrid weight for semantic component (0..1). Default 0.6", "0.6")
    .option("--where <clause>", "Metadata filter, e.g. 'symbol=loadConfig' or 'hu_id=HU-003 AND kind=plan'")
    .option("--rerank", "Apply cross-encoder rerank to top-K (needs @huggingface/transformers, slower but more precise)")
    .option("--rerank-model <name>", "Cross-encoder model id. Default: Xenova/ms-marco-MiniLM-L-6-v2")
    .option("--json", "Output the hits as JSON")
    .action(async (text, flags) => {
      // Stash the rag-specific mode and remove it from the flags object so
      // applyScalarAndBooleanOverrides cannot see a `flags.mode` and write
      // out.review_mode = "hybrid" — that would fail the schema validator.
      const ragMode = flags.ragMode;
      delete flags.ragMode;
      await withConfig(pkgVersion, "rag-query", flags, async ({ config, logger }) => {
        await ragQueryCommand({ text, config, logger, flags: { ...flags, mode: ragMode } });
      });
    });
  // KJC-TSK-0483 — `kj rag eval` runs the golden-query harness and reports
  // recall@5/recall@10/MRR. `--min-recall` turns it into a CI gate.
  rag.command("eval")
    .description("Score the retriever against a golden query set (recall@k + MRR)")
    .option("--golden <path>", "Path to golden queries JSON (default: tests/rag/golden-queries.json)")
    .option("--top-k <n>", "Number of hits to retrieve per query (default: 10)", "10")
    .option("--min-recall <n>", "Fail (exit 1) if aggregated recall@5 falls below this threshold")
    .option("--project <slug>", "Filter by project slug. Pass 'all' to query across every indexed project.")
    .option("--json", "Emit the full report as JSON")
    .action(async (flags) => {
      await withConfig(pkgVersion, "rag-eval", flags, async ({ config, logger }) => {
        await ragEvalCommand({ config, logger, flags });
      });
    });

  // KJC-TSK-0492 PR3 — `kj rag mcp` exposes the kj-rag-mcp binary under the
  // familiar `kj rag <subcommand>` surface so users discover it without
  // grepping bin/. The action dynamic-imports the binary, which takes over
  // stdio for MCP transport; the CLI process never returns.
  rag.command("mcp")
    .description("Start the standalone RAG MCP server (kj_rag_query + kj_rag_index only). Same as running `kj-rag-mcp` directly")
    .action(async () => {
      await ragMcpCommand();
    });

  // KJC-TSK-0509 — `kj qmd query` is a thin wrapper around the upstream
  // `qmd` binary that auto-resolves the project's collection (rag = agent
  // context; qmd = human wiki). One subcommand for now; index/add live in
  // `kj init` and `kj rag install-hooks` (post-merge reindex).
  const qmd = program.command("qmd").description("Semantic search over the per-project QMD wiki (docs/, .reviews/, .karajan/plans/)");
  qmd.command("query <text>")
    .description("Run a qmd query against the wiki collection of the current project")
    .option("--collection <name>", "Override the auto-resolved <slug>-<suffix> collection name")
    .option("--scope <name>", "docs (default) | reviews | plans", "docs")
    .option("--top-k <n>", "Number of hits to return (1..50, default 10)", "10")
    .option("--fast", "Skip the LLM reranker (faster, slightly noisier hits)")
    .option("--json", "Emit the raw JSON array for piping to jq")
    .action(async (text, flags) => {
      await withConfig(pkgVersion, "qmd-query", flags, async ({ config, logger }) => {
        await qmdQueryCommand({ text, config, logger, flags });
      });
    });

  // KJC-TSK-0441 — `kj watch [start|stop|status]` for live RAG re-index.
  const watch = program.command("watch").description("Live RAG re-index daemon");
  watch.command("start").description("Start the watcher daemon").option("--foreground", "Run in foreground (do not detach)").option("--with-sources", "Watch project source files too").action(async (flags) => {
    await withConfig(pkgVersion, "watch:start", flags, async ({ config, logger }) => watchStartCommand({ config, logger, flags }));
  });
  watch.command("stop").description("Stop the watcher daemon").action(async () => {
    await withConfig(pkgVersion, "watch:stop", {}, async ({ logger }) => watchStopCommand({ logger }));
  });
  watch.command("status").description("Report watcher daemon state").action(async () => {
    await withConfig(pkgVersion, "watch:status", {}, async ({ logger }) => watchStatusCommand({ logger }));
  });

  program
    .command("audit")
    .description("Analyze codebase health (read-only)")
    .argument("[task]", "Task description. If absent, defaults to a full-codebase analysis. Use --task-file to point at a .md.")
    .option("--task-file <path>", "Read the task from a file (e.g. .md)")
    .option("--dimensions <list>", "Comma-separated: security,quality,performance,architecture,testing,accessibility (default: all; accessibility auto-skipped on detected backend-only projects)", "all")
    .option("--json", "Output raw JSON")
    .option("--agent-readiness", "Score the repo for AI-agent readability (llms.txt, SKILL.md coverage, page token budgets, robots allowlist, heading hierarchy). LLM-free; uses [path] or cwd as the audit target. See issue #542.")
    .option("--path <dir>", "Path to audit (used with --agent-readiness; defaults to cwd)")
    .option("--no-sonar", "Skip the SonarQube findings collector (faster, less context). Sonar findings are also skipped automatically when SonarQube is unreachable.")
    .option("--no-osv", "Skip the OSV-Scanner vulnerability collector. Findings are also skipped automatically when osv-scanner is not installed.")
    .option("--no-semgrep", "Skip the Semgrep SAST collector. Findings are also skipped automatically when semgrep is not installed (install via 'pipx install semgrep' or 'brew install semgrep').")
    .option("--no-harness", "Skip the AI Harness Scorecard stage (Docker one-shot). Auto-skipped when Docker is unavailable. Each run is also persisted to .karajan/audit-history.db (KJC-TSK-0472) for diff/trend tracking.")
    .option("--no-ai-slop", "Skip the AI-slop tells collector (deterministic regex scan for tautologic comments, banner separators, boilerplate docstrings, magic fallbacks, redundant JSDoc). KJC-TSK-0503.")
    .option("--trend", "Append a sparkline of the harness score across the last 10 runs (uses .karajan/audit-history.db). KJC-TSK-0473.")
    .option("--report-file <path>", "Write the audit report to disk in addition to stdout. <path> may be a file (extension drives format: .md or .json) or a directory (creates audit-<ISO>.<md|json> inside). $KJ_AUDIT_REPORT_DIR env var is used as default directory if no --report-file is given.")
    .option("--deterministic-only", "Skip the LLM analysis entirely. Print/persist only the deterministic findings (basalCost, sonar, stack, growth-delta, webperf). Zero tokens spent. Compatible with --report-file and --json.")
    .option("-y, --yes", "Auto-confirm the 'Continue with LLM analysis?' prompt. Useful in scripts that want the full audit non-interactively. CI/non-TTY paths already auto-confirm without this flag.")
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
          noOsv: flags.osv === false,
          noSemgrep: flags.semgrep === false,
          noHarness: flags.harness === false,
          noAiSlop: flags.aiSlop === false,
          reportFile: flags.reportFile || null,
          deterministicOnly: Boolean(flags.deterministicOnly),
          yes: Boolean(flags.yes),
          trend: Boolean(flags.trend),
        });
      });
    });

  program
    .command("webperf")
    .description("Run a Lighthouse web-perf scan against a URL — Core Web Vitals + opportunities")
    .argument("<url>", "Target URL (e.g. http://localhost:3000)")
    .option("--mobile", "Use the Lighthouse mobile preset (default: desktop)")
    .option("--json", "Output raw JSON")
    .option("--no-persist", "Don't write the result into ~/.karajan/webperf/<slug>/last.json (kj audit reads it from there)")
    .action(async (url, flags) => {
      await withConfig(pkgVersion, "webperf", flags, async ({ config, logger }) => {
        const result = await webperfCommand({
          url,
          config, logger,
          mobile: Boolean(flags.mobile),
          json: Boolean(flags.json),
          persist: flags.persist !== false,
        });
        // Exit with non-zero when the verdict is FAIL so CI can gate.
        if (result && result.ok === false) process.exitCode = 1;
      });
    });

  program
    .command("resume")
    .description("Resume a paused session")
    .argument("<sessionId>")
    .option("--answer <text>", "Answer to the question that caused the pause")
    .option("--non-interactive", "Agents/CI: auto-answer prompts with their safe defaults; stop when there is none. Also enabled by KJ_NON_INTERACTIVE=1.")
    .option("--json", "Output JSON only")
    .action(async (sessionId, flags) => {
      await withConfig(pkgVersion, "resume", flags, async ({ config, logger }) => {
        const res = await resumeCommand({ sessionId, answer: flags.answer, config, logger, flags });
        // KJC-TSK-0674 (issue #1289): same contract as kj run — an aborted
        // resume must be observable by CI.
        if (res?.aborted) process.exitCode = 1;
      });
    });

  program
    .command("update")
    .description("Update karajan-code to the latest version from npm")
    .action(async () => {
      // Output-capturing self-update: npm's deprecation/allow-scripts/funding
      // warnings are hidden on success and only surfaced when the install fails.
      const { performSelfUpdate } = await import("../utils/update-check.js");
      const result = await performSelfUpdate({ currentVersion: pkgVersion });
      if (!result.ok) process.exit(1);
    });

  program
    .command("board [action]")
    .description("Manage HU Board (start|stop|status|open|cleanup)")
    .option("--port <number>", "Port (default: 4000)", "4000")
    .option("--bind <host>", "Bind host (default: 127.0.0.1; use 0.0.0.0 to expose on LAN — token auth auto-enforced)")
    .action(async (action = "start", opts) => {
      await withConfig(pkgVersion, "board", opts, async ({ config, logger }) => {
        const port = Number(opts.port) || config.hu_board?.port || 4000;
        const bind = opts.bind || config.hu_board?.bind || "127.0.0.1";
        await boardCommand({ action, port, bind, logger });
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
    .description("Detect drift between code and the latest plan. Read-only by default; --apply writes a patch back to the Canvas.")
    .option("--plan <planId>", "Sync against a specific plan instead of the latest")
    .option("--json", "Emit machine-readable JSON instead of human output")
    .option("--apply", "Write the drift report into the source Canvas (creates a .bak backup)")
    .action(async (flags) => {
      await withConfig(pkgVersion, "sync", flags, async ({ config, logger }) => {
        await syncCommand({ config, logger, planId: flags.plan, json: flags.json, apply: Boolean(flags.apply) });
      });
    });

  // KJC-TSK-0496 — surface the exact telemetry payload without sending it,
  // and report whether telemetry is currently enabled. Read-only inspection
  // commands so users can audit the contract without grepping the source.
  const telemetry = program.command("telemetry").description("Inspect what Karajan telemetry sends and whether it's enabled (never opens a socket)");
  telemetry.command("preview")
    .description("Print the exact JSON payload for every event type (install, cli_command, pipeline_complete) — no network call")
    .option("--json", "Emit the full preview as JSON")
    .action(async (flags) => {
      await withConfig(pkgVersion, "telemetry:preview", flags, async ({ config, logger }) => {
        await telemetryPreviewCommand({ config, logger, version: pkgVersion, json: Boolean(flags.json) });
      });
    });
  telemetry.command("status")
    .description("Report whether telemetry is enabled and where the endpoint lives")
    .option("--json", "Emit the status as JSON")
    .action(async (flags) => {
      await withConfig(pkgVersion, "telemetry:status", flags, async ({ config, logger }) => {
        await telemetryStatusCommand({ config, logger, json: Boolean(flags.json) });
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
    .option("--repo", "Also report repo-level candidates (merged branches, dist/, coverage/, *.tmp, *.bak)")
    .option("--repo-days <n>", "Age threshold for repo artifacts in days (default: 7)")
    .option("--repo-base <ref>", "Base ref to detect merged branches (default: origin/main)")
    .option("--vector-stores", "Also report orphan RAG vector-store entries in ~/.karajan/rag.db")
    .option("--project-roots <list>", "Colon-separated directories to scan for live projects (default: ~/ws_*, ~/projects, ~/code)")
    .option("--all", "Shortcut for --repo --vector-stores (full read-only cleanup audit)")
    .action(async (flags) => {
      const allOn = Boolean(flags.all);
      await cleanCommand({
        yes: Boolean(flags.yes),
        nuke: Boolean(flags.nuke),
        repo: Boolean(flags.repo) || allOn,
        repoDays: flags.repoDays ? Number(flags.repoDays) : undefined,
        repoBase: flags.repoBase || undefined,
        vectorStores: Boolean(flags.vectorStores) || allOn,
        projectRoots: flags.projectRoots ? flags.projectRoots.split(":").filter(Boolean) : undefined,
        planDays: flags.planDays ? Number(flags.planDays) : undefined,
        draftDays: flags.draftDays ? Number(flags.draftDays) : undefined,
        sessionDays: flags.sessionDays ? Number(flags.sessionDays) : undefined,
        huDays: flags.huDays ? Number(flags.huDays) : undefined,
      });
    });

  program
    .command("harden")
    .description("Install the quality harness (git hooks) into this repo — idempotent")
    .option("--profile <name>", "minimal | standard | strict", "standard")
    .option("--no-config", "Skip lint/format/commit config files (hooks only)")
    .option("--no-ci", "Skip CI quality workflows")
    .option("--no-guidelines", "Skip AI-agent guideline files (AGENTS.md/CLAUDE.md)")
    .option("--mutation", "Also seed an opt-in nightly/manual mutation CI job (never a PR gate)")
    .option("--only <dirs...>", "Harden only these language roots (e.g. frontend backend)")
    .option("--exclude <globs...>", "Skip language roots matching these globs (e.g. wrappers)")
    .option("--report", "Read-only: show what kj would add/improve, change nothing")
    .option("--interactive", "Adopt the kj standard piece by piece (default keeps yours)")
    .option("--dry-run", "Show what would change without writing")
    .option("--json", "Emit machine-readable JSON")
    .action(async (flags) => {
      await withConfig(pkgVersion, "harden", flags, async ({ logger }) => {
        await hardenCommand({
          profile: flags.profile,
          config: flags.config !== false,
          ci: flags.ci !== false,
          guidelines: flags.guidelines !== false,
          mutation: Boolean(flags.mutation),
          only: flags.only ?? [],
          exclude: flags.exclude ?? [],
          report: Boolean(flags.report),
          interactive: Boolean(flags.interactive),
          dryRun: Boolean(flags.dryRun),
          json: Boolean(flags.json),
          logger,
        });
      });
    });

  program
    .command("check")
    .description("Verify the quality harness installed by kj harden (drift gate)")
    .option("--profile <name>", "minimal | standard | strict", "standard")
    .option("--json", "Emit machine-readable JSON")
    .action(async (flags) => {
      const code = await withConfig(pkgVersion, "check", flags, async ({ logger }) =>
        checkCommand({ profile: flags.profile, json: Boolean(flags.json), logger })
      );
      if (Number.isInteger(code)) process.exit(code);
    });

  program
    .command("mutate")
    .description("Diff-scoped mutation testing (¿cazan tus tests los mutantes de tu cambio?)")
    .argument("[path]", "Target explícito a mutar (omite el diff)")
    .option("--since <ref>", "Ref git contra la que sacar el diff", "HEAD~1")
    .option("--max-survivors <n>", "Supervivientes tolerados antes de exit 1", "0")
    .option("--json", "Emitir el resultado normalizado como JSON")
    .action(async (pathArg, flags) => {
      const code = await withConfig(pkgVersion, "mutate", flags, async ({ logger }) =>
        mutateCommand({
          path: pathArg,
          since: flags.since,
          maxSurvivors: Number(flags.maxSurvivors),
          json: Boolean(flags.json),
          logger,
        })
      );
      if (Number.isInteger(code)) process.exit(code);
    });

  // KJC-TSK-0582: index of the advanced/specialized commands kept out of the
  // flat `kj --help` list. Descriptions are read from commander itself so they
  // never drift from each command's own --description.
  program
    .command("advanced")
    .description("List advanced & specialized commands, grouped by area")
    .action(() => {
      const descriptions = Object.fromEntries(program.commands.map((c) => [c.name(), c.description()]));
      console.log(formatAdvancedIndex(descriptions));
    });
}

import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config.js";
import { buildPlannerPrompt } from "../prompts/planner.js";
import { parseMaybeJsonString } from "../review/parser.js";
import { createCliProgressReporter } from "../utils/cli-progress.js";
import { runAutoGC, summarizeGC } from "../utils/garbage-collector.js";
import { promptProjectName } from "../utils/prompt-project-name.js";
import { deriveProjectNameFromCwd } from "../utils/derive-project-name-from-cwd.js";

// ---- Formatting helpers ----

function formatPlan(plan) {
  const lines = [];
  if (plan.approach) lines.push("## Approach", plan.approach, "");
  if (plan.steps?.length) {
    lines.push("## Steps");
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const commit = step.commit ? ` → \`${step.commit}\`` : "";
      lines.push(`${i + 1}. ${step.description}${commit}`);
    }
    lines.push("");
  }
  if (plan.risks?.length) {
    lines.push("## Risks");
    for (const risk of plan.risks) lines.push(`- ${risk}`);
    lines.push("");
  }
  if (plan.outOfScope?.length) {
    lines.push("## Out of scope");
    for (const item of plan.outOfScope) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n");
}

function formatHuTable(hus) {
  if (!hus?.length) return "  (no HUs)";
  const lines = [];
  const maxTitle = Math.min(50, Math.max(...hus.map(h => h.title?.length || 0)));
  lines.push(`  ${"ID".padEnd(30)} ${"Title".padEnd(maxTitle)} ${"Type".padEnd(10)} ${"Status".padEnd(10)} Deps`);
  lines.push(`  ${"─".repeat(30)} ${"─".repeat(maxTitle)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(15)}`);
  for (const hu of hus) {
    const title = (hu.title || "").slice(0, maxTitle).padEnd(maxTitle);
    const deps = (hu.blocked_by || []).join(", ") || "—";
    lines.push(`  ${hu.id.padEnd(30)} ${title} ${(hu.task_type || "sw").padEnd(10)} ${(hu.status || "?").padEnd(10)} ${deps}`);
  }
  return lines.join("\n");
}

// ---- Subcommand handlers ----

/**
 * kj plan "task" — generate plan + HUs
 */
export async function planGenerateCommand({ task, config, logger, json, context, flags = {} }) {
  const { withCliRunLog } = await import("../utils/cli-run-log.js");
  return withCliRunLog("plan", { projectDir: config?.projectDir, logger }, async ({ runLog }) => {
    return planGenerateImpl({ task, config, logger, json, context, runLog, flags });
  });
}

async function planGenerateImpl({ task, config, logger, json, context, runLog, flags = {} }) {
  // Auto-GC: prune orphan plans (project dir gone) + old finalised plans/
  // sessions/HU batches before we start. Silent unless something was
  // removed; one-liner summary on stderr in that case so --json stays
  // untouched. Skipped in test env.
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    try {
      const gcResult = await runAutoGC();
      const line = summarizeGC(gcResult);
      if (line && !json) process.stderr.write(`${line}\n`);
    } catch (err) {
      logger?.warn?.(`Auto-GC failed (non-blocking): ${err.message}`);
    }
  }

  const plannerRole = resolveRole(config, "planner");
  await assertAgentsAvailable([plannerRole.provider]);
  runLog.logText(`[planner] provider=${plannerRole.provider}`);

  const planner = createAgent(plannerRole.provider, config, logger);
  const prompt = buildPlannerPrompt({ task, context });
  const silenceTimeoutMs = Number(config?.session?.max_agent_silence_minutes) > 0
    ? Math.round(Number(config.session.max_agent_silence_minutes) * 60 * 1000)
    : undefined;
  const timeoutMs = Number(config?.session?.max_planner_minutes) > 0
    ? Math.round(Number(config.session.max_planner_minutes) * 60 * 1000)
    : undefined;

  // Live progress to stderr so the user sees what the planner is doing
  // instead of staring at a silent shell for 30 s – 3 min. `--json` mode
  // stays quiet so stdout remains a pure JSON document.
  const progress = createCliProgressReporter({ role: "planner", quiet: Boolean(json) });
  let result;
  try {
    result = await planner.runTask({
      prompt, role: "planner", silenceTimeoutMs, timeoutMs,
      onOutput: progress.onOutput,
    });
    progress.finish(result.ok ? "done" : "failed");
  } catch (err) {
    progress.finish("failed");
    throw err;
  }

  if (!result.ok) throw new Error(result.error || result.output || "Planner failed");

  const parsed = parseMaybeJsonString(result.output);

  // Create v2 plan with HUs from planner steps
  const { createPlanV2 } = await import("../plan/plan-schema.js");
  const { addHu } = await import("../plan/plan-hu-ops.js");
  const { savePlan } = await import("../plan/plan-store.js");
  const { deriveProjectName, classifyTaskType } = await import("../hu/auto-generator.js");

  const projectDir = config.projectDir || process.cwd();
  const plan = createPlanV2(task);
  // Default project name resolution, in priority order:
  //   1. cwd signals — package.json "name" → git remote basename →
  //      directory basename. This is what the user actually expects:
  //      if they ran `git init` in `~/ws_demo/weather-dashboard` and
  //      then asked Karajan to plan, the default name should reflect
  //      THAT directory, not the words of the SPEC document.
  //   2. Fallback: derive from the task text (legacy heuristic). Used
  //      when none of the cwd signals yields anything (e.g. running
  //      from a tmp dir, no git, no package.json — typical for
  //      ad-hoc planning sessions).
  // The user is still prompted to confirm / override on TTY runs;
  // non-interactive runs (--json, --yes, board-spawned subprocesses)
  // accept the default silently.
  const defaultName = deriveProjectNameFromCwd(projectDir) || deriveProjectName(task);
  const canPrompt = process.stdin.isTTY && process.stdout.isTTY
    && !json && !flags?.yes && flags?.interactive !== false;
  plan.name = canPrompt ? await promptProjectName(defaultName) : defaultName;
  plan.approach = parsed?.approach || (typeof parsed === "string" ? parsed : (typeof result.output === "string" ? result.output : null));
  plan.risks = parsed?.risks || [];
  plan.outOfScope = parsed?.outOfScope || [];

  // Convert planner steps → HUs, carrying the structured acceptance_tests
  // the LLM was asked to emit. If the LLM fell back to legacy behaviour
  // (omitted tests or returned an empty array) we DO NOT inject a fake
  // suite-wide placeholder — that was the pre-v2.7.5 lie. Instead we
  // stamp `acceptance_tests: []` and the board / CLI flag the HU as
  // "missing test contract" so the user can either regenerate or edit
  // the tests manually before executing.
  const { normaliseAcceptanceTests } = await import("../plan/plan-schema.js");
  const steps = parsed?.steps || [];
  let prevId = null;
  let stepsMissingTests = 0;
  for (const step of steps) {
    const desc = typeof step === "string" ? step : step.description || step.title || JSON.stringify(step);
    const rawTests = typeof step === "object" ? step.acceptance_tests : null;
    const tests = normaliseAcceptanceTests(rawTests);
    if (tests.length === 0) stepsMissingTests += 1;
    const hu = addHu(plan, {
      title: desc.slice(0, 80),
      task_type: classifyTaskType(desc),
      scope: desc,
      blocked_by: prevId ? [prevId] : [],
      acceptance_tests: tests,
      // Spec mapping (PR C): preserve the planner's section citation
      // so the coder/reviewer / board can show "implements §5.3".
      spec_section: typeof step === "object" && typeof step.spec_section === "string" ? step.spec_section.trim() || null : null,
    });
    prevId = hu.id;
  }
  // Tests-synthesizer pass (v2.7.5): the first planner call asks for
  // acceptance_tests inline, but Claude / Codex frequently skip that
  // sub-instruction on dense specs. If any HU came back without
  // tests, run a focused second pass that ONLY synthesizes tests for
  // those HUs. This is ON by default — the user is paying a CLI
  // subscription, not per-token, so we optimise for plan quality, not
  // round-trip cost. If `--no-tests-synth` (or `--quick`) is set, we
  // skip and warn loudly that `kj run --plan` will refuse to execute.
  const skipSynth = Boolean(flags?.noTestsSynth || flags?.quick);
  if (stepsMissingTests > 0 && !skipSynth) {
    runLog.logText(
      `[planner] ${stepsMissingTests}/${steps.length} HUs missing acceptance_tests — running tests-synthesizer pass`
    );
    progress.onOutput?.({ line: `${stepsMissingTests} HU(s) missing tests — running synthesizer pass`, kind: "text" });
    const { synthesizeMissingTests } = await import("../plan/tests-synthesizer.js");
    const husNeedingTests = plan.hus
      .filter((h) => !Array.isArray(h.acceptance_tests) || h.acceptance_tests.length === 0)
      .map((h) => ({ id: h.id, title: h.title, scope: h.scope }));
    const synthResult = await synthesizeMissingTests({
      agent: planner,
      task,
      husNeedingTests,
      onOutput: progress.onOutput,
      silenceTimeoutMs,
      timeoutMs,
    });
    if (synthResult.ok) {
      let patched = 0;
      for (const hu of plan.hus) {
        const tests = synthResult.tests[hu.id];
        if (tests && tests.length > 0) {
          hu.acceptance_tests = tests;
          hu.updatedAt = new Date().toISOString();
          patched += 1;
        }
      }
      stepsMissingTests = plan.hus.filter((h) => !h.acceptance_tests?.length).length;
      runLog.logText(
        `[planner] tests-synthesizer patched ${patched}/${husNeedingTests.length} HUs (${stepsMissingTests} still missing)`
      );
    } else {
      runLog.logText(`[planner] tests-synthesizer failed: ${synthResult.error}`);
    }
  }

  if (stepsMissingTests > 0) {
    runLog.logText(
      `[planner] WARN: ${stepsMissingTests}/${steps.length} HUs still have no acceptance_tests after the synthesizer pass. `
      + `Edit them on the board (✎ Edit) or re-run \`kj plan\`. \`kj run --plan\` will refuse to execute these HUs.`
    );
  }

  // Plan reviewer pass (PR D). Asks five closed-ended questions
  // about the just-generated plan: missing HUs, missing deps, scope
  // overlap, parallelisable groups, order issues. Output is purely
  // advisory — we surface the findings to the user and they decide
  // whether to apply them. Skipped when --no-plan-review or --quick.
  const skipReview = Boolean(flags?.noPlanReview || flags?.quick);
  if (plan.hus.length > 0 && !skipReview) {
    runLog.logText("[planner] running plan reviewer pass");
    progress.onOutput?.({ line: "Reviewing the plan for gaps / overlaps / order issues", kind: "text" });
    const { reviewPlan, findingsCount } = await import("../plan/plan-reviewer.js");
    const review = await reviewPlan({
      agent: planner,
      task,
      hus: plan.hus,
      onOutput: progress.onOutput,
      silenceTimeoutMs,
      timeoutMs,
    });
    if (review.ok) {
      plan.review = review.findings;
      const count = findingsCount(review.findings);
      runLog.logText(
        count > 0
          ? `[planner] reviewer surfaced ${count} item(s): ${review.findings.summary || "(see plan.review for details)"}`
          : `[planner] reviewer found nothing actionable: ${review.findings.summary || "OK"}`
      );
    } else {
      runLog.logText(`[planner] reviewer pass failed (non-blocking): ${review.error}`);
    }
  }

  const planId = await savePlan(projectDir, plan);
  const { plansDir } = await import("../plan/plan-store.js");
  const path = await import("node:path");
  const planPath = path.join(plansDir(projectDir), `${planId}.json`);

  runLog.logText(`[planner] finished — hus=${plan.hus.length} plan=${planId}`);

  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return { ok: true };
  }

  if (parsed?.approach) {
    console.log(formatPlan(parsed));
  } else if (plan.approach) {
    console.log(plan.approach);
  }
  console.log(`\n## HUs (${plan.hus.length})`);
  console.log(formatHuTable(plan.hus));
  // Tell the user what just happened and what their two real options are.
  // Pre-v2.7.5 we printed Review / Approve / Execute as three lines, which
  // confused everyone:
  //   - "Review" sounded like an action; `kj plan show` is read-only.
  //   - "Approve" exposed the internal `kj plan ready` gate that the board
  //     workflow now bypasses (the board's "Run plan" button calls
  //     `kj run --plan` directly and the tests-first gate is enforced there).
  // Now we just say: inspect, then run. The board is the recommended UI.
  console.log(`\nPlan saved: ${planId} (${plan.hus.length} HUs, status: ${plan.status})`);
  console.log(`         → ${planPath}`);
  // Reviewer findings: print a short summary so the user knows
  // at-a-glance whether the plan needs attention. Full details live
  // in `plan.review` and `kj plan show <id>` renders them.
  if (plan.review) {
    const r = plan.review;
    const counts = [
      r.missing_hus?.length ? `${r.missing_hus.length} missing HU(s)` : null,
      r.missing_dependencies?.length ? `${r.missing_dependencies.length} missing dep(s)` : null,
      r.scope_overlaps?.length ? `${r.scope_overlaps.length} overlap(s)` : null,
      r.order_issues?.length ? `${r.order_issues.length} order issue(s)` : null,
    ].filter(Boolean);
    if (counts.length === 0) {
      console.log(`Reviewer: ✓ ${r.summary || "no issues"}`);
    } else {
      console.log(`Reviewer flagged: ${counts.join(", ")} — see \`kj plan show ${planId}\``);
    }
  }
  console.log("");
  console.log(`Inspect: kj plan show ${planId}`);
  console.log(`Run:     kj run --plan ${planId} "${task.slice(0, 40)}..."`);
  console.log(`         (or click ▶ Run plan on the board, if running)`);

  // UX boost for HU-bearing plans: auto-start the HU Board (same pattern as
  // `kj run` auto-HU generation) so the user can inspect the 12-HU plan in a
  // browser instead of squinting at the ASCII table. The board reads
  // ~/.kj/plans/ directly, so this plan is visible immediately. Never in
  // vitest / test mode, and never when `--json` is active.
  if (plan.hus.length > 0 && !process.env.VITEST && process.env.NODE_ENV !== "test") {
    try {
      const { startBoard, renderBoardBanner } = await import("./board.js");
      const { projectSlug: slugFor } = await import("../plan/plan-store.js");
      const boardPort = config?.hu_board?.port ?? 4000;
      // `projectSlug` scopes the board URL to this project's view
      // (`/p/<slug>`) instead of the global "All projects" dashboard. The
      // board UI hides multi-project chrome when it sees that prefix.
      const boardResult = await startBoard(boardPort, { projectSlug: slugFor(projectDir) });
      const status = boardResult.alreadyRunning ? "already running" : "started";
      console.log(renderBoardBanner({ url: boardResult.url, status, projectName: plan.name }));
    } catch (err) {
      // Non-blocking: plan is saved, only the visualiser failed.
      logger?.warn?.(`HU Board auto-start failed (non-blocking): ${err.message}`);
      console.log(`\nVisualize: kj board start (http://localhost:${config?.hu_board?.port ?? 4000})`);
    }
  }
  return { ok: true };
}

/**
 * kj plan list
 */
export async function planListCommand({ config }) {
  const { listPlans } = await import("../plan/plan-store.js");
  const projectDir = config.projectDir || process.cwd();
  const plans = await listPlans(projectDir);

  if (plans.length === 0) {
    console.log("No plans found. Create one with: kj plan \"your task\"");
    return;
  }

  console.log(`Plans for ${projectDir}:\n`);
  for (const p of plans) {
    const husInfo = p.huCount > 0 ? ` (${p.huCount} HUs)` : "";
    const status = p.status !== "draft" ? ` [${p.status}]` : "";
    console.log(`  ${p.planId}  ${(p.name || p.task || "").slice(0, 50)}${husInfo}${status}`);
    console.log(`    Created: ${p.createdAt}`);
  }
}

/**
 * kj plan show <planId>
 */
export async function planShowCommand({ config, planId }) {
  const { loadPlan } = await import("../plan/plan-store.js");
  const projectDir = config.projectDir || process.cwd();
  const plan = await loadPlan(projectDir, planId);

  if (!plan) {
    console.error(`Plan not found: ${planId}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Plan: ${plan.planId}`);
  console.log(`Task: ${plan.task}`);
  console.log(`Name: ${plan.name || "—"}`);
  console.log(`Status: ${plan.status}`);
  console.log(`Version: ${plan.version}`);
  console.log(`Created: ${plan.createdAt}`);

  if (plan.approach) {
    console.log(`\n## Approach\n${plan.approach}`);
  }

  if (plan.hus?.length > 0) {
    console.log(`\n## HUs (${plan.hus.length})`);
    console.log(formatHuTable(plan.hus));
  } else {
    console.log("\nNo HUs defined. Add with: kj plan add-hu " + planId);
  }

  // Reviewer findings (PR D). When the planner ran with the plan
  // reviewer pass enabled, plan.review carries advisory findings —
  // missing HUs, missing deps, scope overlaps, parallelisable
  // groups, order issues. Each section only renders when non-empty
  // so a clean plan stays clean on screen.
  if (plan.review) {
    const r = plan.review;
    const sections = [];
    if (r.missing_hus?.length) {
      sections.push(`### Missing HUs (${r.missing_hus.length})`);
      for (const m of r.missing_hus) {
        sections.push(`- §${m.spec_section}: ${m.rationale}`);
      }
    }
    if (r.missing_dependencies?.length) {
      sections.push(`\n### Missing dependencies (${r.missing_dependencies.length})`);
      for (const d of r.missing_dependencies) {
        sections.push(`- ${d.from} should depend on ${d.on} — ${d.rationale}`);
      }
    }
    if (r.scope_overlaps?.length) {
      sections.push(`\n### Scope overlaps (${r.scope_overlaps.length})`);
      for (const o of r.scope_overlaps) {
        sections.push(`- ${o.between.join(" ↔ ")}: ${o.rationale}`);
      }
    }
    if (r.parallelisable_groups?.length) {
      sections.push(`\n### Parallelisable groups (${r.parallelisable_groups.length})`);
      for (const g of r.parallelisable_groups) {
        sections.push(`- ${g.hus.join(" + ")}${g.rationale ? ` — ${g.rationale}` : ""}`);
      }
    }
    if (r.order_issues?.length) {
      sections.push(`\n### Order issues (${r.order_issues.length})`);
      for (const o of r.order_issues) {
        sections.push(`- ${o.hus.join(", ")} (${o.issue}): ${o.rationale}`);
      }
    }
    if (sections.length > 0) {
      console.log("\n## Reviewer findings");
      if (r.summary) console.log(`_${r.summary}_\n`);
      console.log(sections.join("\n"));
    } else if (r.summary) {
      console.log(`\n## Reviewer findings\n_${r.summary}_`);
    }
  }
}

/**
 * kj plan ready <planId>
 */
export async function planReadyCommand({ config, planId }) {
  const { loadPlan, savePlan } = await import("../plan/plan-store.js");
  const { certifyAllHus } = await import("../plan/plan-hu-ops.js");
  const { validatePlan } = await import("../plan/plan-schema.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const validation = validatePlan(plan);
  if (!validation.valid) {
    console.error("Plan validation failed:");
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exitCode = 1;
    return;
  }

  if (plan.hus.length === 0) {
    console.error("Cannot approve a plan with 0 HUs.");
    process.exitCode = 1;
    return;
  }

  // Tests-first gate: refuse to certify HUs that have no acceptance_tests.
  // A "ready" plan must have an executable test contract per HU, otherwise
  // the coder has nothing to aim for. Flag each offender, then bail so the
  // user can edit the plan (board ✎ Edit or `kj plan add-hu`) and retry.
  const missing = plan.hus.filter((h) => !Array.isArray(h.acceptance_tests) || h.acceptance_tests.length === 0);
  if (missing.length > 0) {
    console.error(`Cannot mark ready: ${missing.length}/${plan.hus.length} HU(s) have no acceptance_tests:`);
    for (const h of missing) console.error(`  - ${h.id}  ${(h.title || "").slice(0, 60)}`);
    console.error("");
    console.error("Tests-first flow requires a test contract per HU. Edit each HU on the board");
    console.error("(http://localhost:4000) via the ✎ Edit button, or re-run `kj plan` to regenerate.");
    process.exitCode = 1;
    return;
  }

  const count = certifyAllHus(plan);
  await savePlan(projectDir, plan);
  console.log(`✅ ${count} HUs certified. Plan status: ready`);
  console.log(`Run: kj run --plan ${planId} "${(plan.task || "").slice(0, 40)}..."`);
}

/**
 * kj plan validate <planId>
 */
export async function planValidateCommand({ config, planId }) {
  const { loadPlan } = await import("../plan/plan-store.js");
  const { validatePlan } = await import("../plan/plan-schema.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const result = validatePlan(plan);
  if (result.valid) {
    console.log(`✅ Plan ${planId} is valid (${plan.hus.length} HUs, status: ${plan.status})`);
  } else {
    console.error(`❌ Plan ${planId} has ${result.errors.length} error(s):`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exitCode = 1;
  }
}

/**
 * kj plan delete <planId>
 */
export async function planDeleteCommand({ config, planId }) {
  const { deletePlan } = await import("../plan/plan-store.js");
  const projectDir = config.projectDir || process.cwd();
  const ok = await deletePlan(projectDir, planId);
  console.log(ok ? `Deleted: ${planId}` : `Not found: ${planId}`);
}

/**
 * kj plan add-hu <planId> --title "..." --type sw --deps hu_xxx
 */
export async function planAddHuCommand({ config, planId, title, type, deps, scope }) {
  const { loadPlan, savePlan } = await import("../plan/plan-store.js");
  const { addHu } = await import("../plan/plan-hu-ops.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const hu = addHu(plan, {
    title: title || "New HU",
    task_type: type || "sw",
    scope: scope || null,
    blocked_by: deps ? deps.split(",").map(d => d.trim()) : []
  });

  await savePlan(projectDir, plan);
  console.log(`Added: ${hu.id} — ${hu.title}`);
}

/**
 * kj plan remove-hu <planId> <huId>
 */
export async function planRemoveHuCommand({ config, planId, huId }) {
  const { loadPlan, savePlan } = await import("../plan/plan-store.js");
  const { removeHu } = await import("../plan/plan-hu-ops.js");
  const projectDir = config.projectDir || process.cwd();

  const plan = await loadPlan(projectDir, planId);
  if (!plan) { console.error(`Plan not found: ${planId}`); process.exitCode = 1; return; }

  const ok = removeHu(plan, huId);
  if (!ok) { console.error(`HU not found: ${huId}`); process.exitCode = 1; return; }

  await savePlan(projectDir, plan);
  console.log(`Removed: ${huId}`);
}

// Keep backward compat — old callers import planCommand
export const planCommand = planGenerateCommand;

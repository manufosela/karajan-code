import { createAgent } from "../../agents/index.js";
import { assertAgentsAvailable } from "../../agents/availability.js";
import { resolveRole } from "../../config.js";
import { buildPlannerPrompt } from "../../prompts/planner.js";
import { parseMaybeJsonString } from "../../review/parser.js";
import { createCliProgressReporter } from "../../utils/cli-progress.js";
import { runAutoGC, summarizeGC } from "../../utils/garbage-collector.js";
import { promptProjectName } from "../../utils/prompt-project-name.js";
import { deriveProjectNameFromCwd } from "../../utils/derive-project-name-from-cwd.js";
import { applyReviewerFeedback, applyFixerPatch } from "../../plan/plan-fixer.js";
import { formatPlan, formatHuTable } from "./_shared.js";

/**
 * kj plan "task" — generate plan + HUs
 */
export async function planGenerateCommand({ task, config, logger, json, context, flags = {} }) {
  const { withCliRunLog } = await import("../../utils/cli-run-log.js");
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
  const { createPlanV2 } = await import("../../plan/plan-schema.js");
  const { addHu } = await import("../../plan/plan-hu-ops.js");
  const { savePlan } = await import("../../plan/plan-store.js");
  const { deriveProjectName, classifyTaskType } = await import("../../hu/auto-generator.js");

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
  const { normaliseAcceptanceTests } = await import("../../plan/plan-schema.js");
  const steps = parsed?.steps || [];
  let stepsMissingTests = 0;

  // Two-pass HU creation (KJC-TSK-0382 follow-up):
  //   Pass 1 — create every HU with `blocked_by: []` and remember the
  //            mapping `<symbolic id from planner> -> <stable hu id>`.
  //   Pass 2 — translate the planner's `dependencies: [symbolicId, …]`
  //            into the corresponding `blocked_by: [huId, …]`.
  // The split is needed because `addHu` assigns the stable id at insertion
  // time, so a forward reference (step B depends on step A whose hu id
  // doesn't exist yet) would otherwise be impossible to resolve.
  const symbolicToHuId = new Map();
  const stepDeps = []; // parallel array: stepDeps[i] = array of symbolic dep ids
  const stepReuse = []; // parallel array: stepReuse[i] = array of symbolic reuse ids (KJC-BUG-0044 / P3)
  for (const step of steps) {
    const desc = typeof step === "string" ? step : step.description || step.title || JSON.stringify(step);
    const rawTests = typeof step === "object" ? step.acceptance_tests : null;
    const tests = normaliseAcceptanceTests(rawTests);
    if (tests.length === 0) stepsMissingTests += 1;
    const hu = addHu(plan, {
      title: desc.slice(0, 80),
      task_type: classifyTaskType(desc),
      scope: desc,
      blocked_by: [],
      acceptance_tests: tests,
      // Spec mapping (PR C): preserve the planner's section citation
      // so the coder/reviewer / board can show "implements §5.3".
      spec_section: typeof step === "object" && typeof step.spec_section === "string" ? step.spec_section.trim() || null : null,
    });
    if (typeof step === "object" && typeof step.id === "string" && step.id.trim()) {
      symbolicToHuId.set(step.id.trim(), hu.id);
    }
    const deps = typeof step === "object" && Array.isArray(step.dependencies) ? step.dependencies : [];
    stepDeps.push(deps);
    const reuse = typeof step === "object" && Array.isArray(step.reuse) ? step.reuse : [];
    stepReuse.push(reuse);
  }
  // Pass 2: resolve dependencies + reuse. Unknown symbolic ids are dropped
  // silently (the plan-reviewer pass will flag them as gaps if they matter).
  for (let i = 0; i < plan.hus.length; i++) {
    const symbolicDeps = stepDeps[i] || [];
    const resolvedDeps = symbolicDeps
      .map((s) => typeof s === "string" ? symbolicToHuId.get(s.trim()) : null)
      .filter(Boolean);
    if (resolvedDeps.length > 0) plan.hus[i].blocked_by = resolvedDeps;
    const symbolicReuse = stepReuse[i] || [];
    const resolvedReuse = symbolicReuse
      .map((s) => typeof s === "string" ? symbolicToHuId.get(s.trim()) : null)
      .filter(Boolean);
    if (resolvedReuse.length > 0) plan.hus[i].reuse = resolvedReuse;
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
    const { synthesizeMissingTests } = await import("../../plan/tests-synthesizer.js");
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
    const { reviewPlan, findingsCount } = await import("../../plan/plan-reviewer.js");
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
      // KJC-BUG-0045 / P4: self-fix loop. The reviewer is flag-only by
      // contract; when it surfaces actionable issues, ask the planner to
      // PATCH the plan, apply in-process, and re-review. Loop until 0
      // findings or maxIterations. Skippable with --no-plan-fixer/--quick.
      const skipFixer = Boolean(flags?.noPlanFixer || flags?.quick);
      const maxFixerIterations = 2;
      if (count > 0 && !skipFixer) {
        for (let i = 1; i <= maxFixerIterations; i++) {
          const currentCount = findingsCount(plan.review);
          if (currentCount === 0) break;
          runLog.logText(`[planner] self-fix iter ${i}/${maxFixerIterations} — patching ${currentCount} issue(s)`);
          progress.onOutput?.({ line: `Self-fix iter ${i}: patching ${currentCount} issue(s)`, kind: "text" });
          const fix = await applyReviewerFeedback({
            agent: planner, task, hus: plan.hus, findings: plan.review,
            onOutput: progress.onOutput, silenceTimeoutMs, timeoutMs,
          });
          if (!fix.ok) {
            runLog.logText(`[planner] self-fix iter ${i} failed (non-blocking): ${fix.error}`);
            break;
          }
          const ops = applyFixerPatch(plan, fix.patch);
          runLog.logText(`[planner] self-fix iter ${i} applied: +${ops.added} HU, +${ops.depsAdded} dep, -${ops.deleted} HU`);
          if (ops.added + ops.depsAdded + ops.deleted === 0) {
            runLog.logText(`[planner] self-fix iter ${i} empty patch — stopping`);
            break;
          }
          const review2 = await reviewPlan({
            agent: planner, task, hus: plan.hus,
            onOutput: progress.onOutput, silenceTimeoutMs, timeoutMs,
          });
          if (!review2.ok) {
            runLog.logText(`[planner] re-review after iter ${i} failed: ${review2.error}`);
            break;
          }
          plan.review = review2.findings;
          runLog.logText(`[planner] after self-fix iter ${i}: ${findingsCount(review2.findings)} issue(s) remaining`);
        }
      }
    } else {
      runLog.logText(`[planner] reviewer pass failed (non-blocking): ${review.error}`);
    }
  }

  const planId = await savePlan(projectDir, plan);
  const { plansDir } = await import("../../plan/plan-store.js");
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
      const { startBoard, renderBoardBanner } = await import("../board.js");
      const { projectSlug: slugFor } = await import("../../plan/plan-store.js");
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

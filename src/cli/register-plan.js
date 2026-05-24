import {
  planGenerateCommand,
  planListCommand,
  planShowCommand,
  planReadyCommand,
  planValidateCommand,
  planDeleteCommand,
  planAddHuCommand,
  planRemoveHuCommand,
  planMigrateResultCommand,
  planFixCommand,
} from "../commands/plan.js";
import { parseCanvasMarkdown } from "../canvas/parse-md.js";
import { validateCanvas } from "../canvas/validate.js";
import { canvasToTask } from "../canvas/to-flat.js";
import { withConfig } from "./_shared.js";

/**
 * Register the `plan` parent command and every sub-command that lives
 * under it (generate / list / show / ready / validate / delete /
 * add-hu / remove-hu). Centralising plan management here keeps the
 * REASONS Canvas auto-detection logic in one file alongside the
 * planner entrypoint.
 */
export function registerPlan(program, { pkgVersion }) {
  const plan = program.command("plan").description("Plan management (generate, review, approve, execute)");

  plan
    .command("generate", { isDefault: true })
    .description("Generate implementation plan with HUs")
    .argument("[task]", "Task description (REQUIRED — provide as argument or via --task-file)")
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
    .option("--skip-spec-review", "Bypass the spec-reviewer pre-pipeline audit")
    .option("--quick", "Sketch mode — skip every quality pass after the initial planner call")
    .option("--no-preflight-hu", "Skip auto-injection of [PREFLIGHT-000] HU at the top of the generated plan")
    .option("--use-onboarding", "Inject the cached Architecture Brief (~/.karajan/onboarding/<slug>.md) into the planner context")
    .option("-y, --yes", "Skip the project-name prompt (use the auto-derived default).")
    .option("--no-interactive", "Force non-interactive mode (no prompts, use defaults).")
    .action(async (task, flags) => {
      await withConfig(pkgVersion, "plan", flags, async ({ config, logger }) => {
        const { resolveTaskInput } = await import("../utils/task-file.js");
        const resolvedTask = await resolveTaskInput({ task, taskFile: flags.taskFile, projectDir: config.projectDir, logger });

        // REASONS Canvas auto-detection: a SPEC that contains
        // `## REASONS:Section` headings is treated as a structured
        // Canvas — parsed + validated BEFORE the planner runs. This
        // catches broken acceptance tests (jq syntax, bash parse,
        // gherkin missing Given/Then, the 2026-04-29 as-binding
        // misuse class) at plan-time, without spending LLM dollars.
        //
        // Detection by file CONTENTS, not by CLI flag — the Canvas
        // format is the signal. Flat SPECs without REASONS sections
        // continue through the legacy path unchanged (back-compat).
        if (typeof resolvedTask === "string" && /^##\s+REASONS:/m.test(resolvedTask)) {
          let parsed;
          try {
            parsed = parseCanvasMarkdown(resolvedTask);
          } catch (err) {
            throw new Error(`Canvas parse error: ${err.message}`, { cause: err });
          }
          const validation = validateCanvas(parsed);
          if (!validation.valid) {
            const lines = ["Canvas validation failed."];
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
          // Pass the Canvas-derived flat task to the existing planner.
          // Norms + Safeguards ride along under explicit headings the
          // coder prompt can grep for.
          const taskFromCanvas = canvasToTask(validation.canvas);
          await planGenerateCommand({ task: taskFromCanvas, config, logger, flags });
          return;
        }
        await planGenerateCommand({
          task: resolvedTask, config, logger, json: flags.json, context: flags.context,
          flags: {
            noTestsSynth: flags.testsSynth === false,
            noPlanReview: flags.planReview === false,
            quick: Boolean(flags.quick),
            yes: Boolean(flags.yes),
            interactive: flags.interactive,
            preflightHu: flags.preflightHu !== false, // KJC-TSK-0397
            useOnboarding: Boolean(flags.useOnboarding), // KJC-TSK-0384 PR 3
          },
        });
      });
    });

  plan.command("list").description("List all plans").action(async (flags) => {
    await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
      // TSK-0340: was `await import(...)` — now served by the top-level static import.
      await planListCommand({ config });
    });
  });

  plan.command("show").description("Show plan details + HUs").argument("<planId>").action(async (planId, flags) => {
    await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
      await planShowCommand({ config, planId });
    });
  });

  plan.command("ready").description("Approve plan — certify all HUs").argument("<planId>").action(async (planId, flags) => {
    await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
      await planReadyCommand({ config, planId });
    });
  });

  plan.command("validate").description("Validate plan structure").argument("<planId>").action(async (planId, flags) => {
    await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
      await planValidateCommand({ config, planId });
    });
  });

  plan.command("delete").description("Delete a plan").argument("<planId>").action(async (planId, flags) => {
    await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
      await planDeleteCommand({ config, planId });
    });
  });

  plan.command("add-hu").description("Add HU to plan").argument("<planId>")
    .option("--title <text>", "HU title")
    .option("--type <type>", "Task type: sw|infra|doc|add-tests|refactor|nocode", "sw")
    .option("--deps <ids>", "Comma-separated HU IDs this depends on")
    .option("--scope <text>", "Scope description")
    .action(async (planId, flags) => {
      await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
        await planAddHuCommand({ config, planId, title: flags.title, type: flags.type, deps: flags.deps, scope: flags.scope });
      });
    });

  plan.command("remove-hu").description("Remove HU from plan").argument("<planId>").argument("<huId>").action(async (planId, huId, flags) => {
    await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
      await planRemoveHuCommand({ config, planId, huId });
    });
  });

  // KJC-TSK-0402: re-ejecuta reviewer + self-fix + structural pass sobre
  // un plan existente. Acepta --prompt opcional con feedback humano que
  // el reviewer inyecta como contexto extra antes de revisar.
  plan.command("fix")
    .description("Relanzar self-fix loop sobre plan existente (con --prompt opcional)")
    .argument("<planId>")
    .option("--prompt <text>", "Feedback del usuario para guiar al reviewer")
    .option("--json", "Output JSON con before/after counts")
    .action(async (planId, flags) => {
      await withConfig(pkgVersion, "plan", flags, async ({ config, logger }) => {
        await planFixCommand({ config, planId, prompt: flags.prompt, logger, json: flags.json });
      });
    });

  // KJC-TSK-0394 step 4: migración one-shot que siembra `result` en las
  // HUs de los plan files existentes (basado en su status legacy). Solo
  // toca el campo result, NO el status — el cleanup del enum lo hará
  // step 5. Idempotente.
  plan.command("migrate-result")
    .description("Backfill the `result` field on existing plan HUs (KJC-TSK-0394 step 4)")
    .option("--dry-run", "Show what would change without writing")
    .action(async (flags) => {
      await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
        await planMigrateResultCommand({ config, flags: { dryRun: flags.dryRun } });
      });
    });
}

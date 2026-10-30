import {
  planListCommand,
  planShowCommand,
  planReadyCommand,
  planValidateCommand,
  planDeleteCommand,
  planAddHuCommand,
  planRemoveHuCommand,
  planMigrateResultCommand,
  planFixCommand,
  planShareCommand,
  planUnshareCommand,
} from "../commands/plan.js";
import { planLicenseCommand } from "../commands/plan/license.js";
import { withConfig } from "./_shared.js";
import { retire } from "./retired-commands.js";

/**
 * Register the `plan` parent command and every sub-command that lives
 * under it (list / show / ready / validate / delete / add-hu / remove-hu...).
 */
export function registerPlan(program, { pkgVersion }) {
  const plan = program.command("plan").description("Plan management (list, show, validate, approve)");

  // KJC-TSK-1317: retired in 5.0; it answers to say what replaced it.
  plan
    .command("generate", { hidden: true })
    .argument("[args...]")
    .allowUnknownOption()
    .allowExcessArguments()
    .action(() => retire("plan generate"));

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

  // KJC-PRP-0002 / v2.31.0 PR1: promote a local plan into the project's
  // `.karajan-shared/plans/` so teammates picking up the repo (or the same
  // dev on another machine) see it in their HU Board without re-running
  // the planner. The shared dir is meant to be committed to git.
  plan.command("share")
    .description("Promote a local plan to <projectDir>/.karajan-shared/ so the team can see it")
    .argument("<planId>")
    .option("--only <ids>", "Comma-separated HU IDs to include (share a subset)")
    .option("--exclude <ids>", "Comma-separated HU IDs to omit from the shared copy")
    .action(async (planId, flags) => {
      await withConfig(pkgVersion, "plan", flags, async ({ config, logger }) => {
        await planShareCommand({ config, planId, logger, only: flags.only, exclude: flags.exclude });
      });
    });

  // KJC-PRP-0002 / v2.31.0 PR3: inverse of `kj plan share`. Removes the plan
  // from `.karajan-shared/plans/` but keeps the per-user copy intact, so the
  // dev still has the plan locally while the team stops seeing it.
  plan.command("unshare")
    .description("Remove a plan from <projectDir>/.karajan-shared/ (keeps local copy)")
    .argument("<planId>")
    .action(async (planId, flags) => {
      await withConfig(pkgVersion, "plan", flags, async ({ config, logger }) => {
        await planUnshareCommand({ config, planId, logger });
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

  // KJC-TSK-0717 (SPD-A): the REWORK licence, from the module's mutation score.
  plan.command("license").description("Score a module with kj mutate and record the REWORK licence on an HU")
    .argument("<planId>").argument("<huId>").requiredOption("--module <path>", "The module the REWORK regenerates")
    .action(async (planId, huId, flags) => {
      await withConfig(pkgVersion, "plan", flags, async ({ config }) => {
        process.exitCode = await planLicenseCommand({ config, planId, huId, module: flags.module });
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

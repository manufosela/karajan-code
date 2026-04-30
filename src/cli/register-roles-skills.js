import { rolesCommand } from "../commands/roles.js";
import { agentsCommand } from "../commands/agents.js";
import { withConfig } from "./_shared.js";

/**
 * Register the meta-configuration commands the user reaches for when
 * setting up the pipeline itself: which skills to load, which roles
 * are wired in, which provider is mapped to each agent slot.
 */
export function registerRolesSkills(program, { pkgVersion }) {
  program
    .command("skills [action]")
    .description("Manage the skill cache (actions: list | clear-cache | sync-addyosmani | list-addyosmani)")
    .action(async (action) => {
      const { skillsCommand } = await import("../commands/skills.js");
      const exitCode = await skillsCommand({ action: action || "list" });
      if (Number.isInteger(exitCode)) process.exit(exitCode);
    });

  program
    .command("roles [subcommand] [role]")
    .description("List pipeline roles or show role template instructions")
    .action(async (subcommand, role) => {
      await withConfig(pkgVersion, "roles", {}, async ({ config }) => {
        await rolesCommand({ config, subcommand: subcommand || "list", roleName: role });
      });
    });

  program
    .command("agents [subcommand] [role] [provider]")
    .description("List or change AI agent assignments per role (e.g. kj agents set coder gemini)")
    .option("--global", "Persist change to kj.config.yml (default for CLI)")
    .action(async (subcommand, role, provider, flags) => {
      await withConfig(pkgVersion, "agents", {}, async ({ config }) => {
        await agentsCommand({ config, subcommand: subcommand || "list", role, provider, global: flags.global });
      });
    });
}

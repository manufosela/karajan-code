#!/usr/bin/env node
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { registerPipeline } from "./cli/register-pipeline.js";
import { registerPlan } from "./cli/register-plan.js";
import { registerRolesSkills } from "./cli/register-roles-skills.js";
import { registerMeta } from "./cli/register-meta.js";
import { registerSonar } from "./cli/register-sonar.js";
import { registerStandby } from "./cli/register-standby.js";
import { printUpdateNotice } from "./utils/update-check.js";
import { printWelcomeScreen } from "./utils/welcome.js";
import { migrateKjToKarajan } from "./utils/home-migration.js";

const PKG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
const PKG_VERSION = JSON.parse(readFileSync(PKG_PATH, "utf8")).version;

// Non-blocking update check (runs in background, prints after command output)
printUpdateNotice(PKG_VERSION).catch(() => {});

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

registerPipeline(program, { pkgVersion: PKG_VERSION });
registerPlan(program, { pkgVersion: PKG_VERSION });
registerRolesSkills(program, { pkgVersion: PKG_VERSION });
registerMeta(program, { pkgVersion: PKG_VERSION });
registerSonar(program);
registerStandby(program);

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

// One-shot ~/.kj/ → ~/.karajan/ consolidation. Idempotent via marker
// file; failures non-blocking. See src/utils/home-migration.js.
// Static import — the migrator runs on every kj invocation, no
// lazy-load benefit + the architectural dynamic-imports budget would
// otherwise grow by one for a permanent caller.
try {
  await migrateKjToKarajan();
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`\x1b[33m[warn]\x1b[0m home migration skipped: ${err.message}`);
}

try {
  await program.parseAsync();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

import { printBanner } from "./banner.js";

const A = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
};

const QUICK_START = [
  ["kj run <task>",  "Run the full coder+reviewer pipeline"],
  ["kj init",        "Initialize config and setup"],
  ["kj doctor",      "Check environment and agent availability"],
  ["kj status",      "Show pipeline dashboard"],
  ["kj report",      "Show latest session report"],
];

/**
 * Print the CLI welcome screen.
 * @param {object} opts
 * @param {string} opts.version - Version string (required)
 * @param {object} [opts.config]  - Loaded KJ config (optional, shows configured agents)
 */
export function printWelcomeScreen({ version, config = null }) {
  printBanner(version, { force: true });

  if (config) {
    const coder    = config.roles?.coder?.provider    || config.coder    || "claude";
    const reviewer = config.roles?.reviewer?.provider || config.reviewer || "codex";
    console.log(`  ${A.bold}Agents${A.reset}`);
    console.log(`    ${A.dim}coder:${A.reset}    ${coder}`);
    console.log(`    ${A.dim}reviewer:${A.reset} ${reviewer}`);
    console.log();
  }

  console.log(`  ${A.bold}Quick start${A.reset}`);
  for (const [cmd, desc] of QUICK_START) {
    const padded = cmd.padEnd(20);
    console.log(`    ${A.green}${padded}${A.reset}  ${A.dim}${desc}${A.reset}`);
  }

  console.log();
  console.log(`  ${A.dim}Run ${A.reset}kj --help${A.dim} to see all commands.${A.reset}`);
  console.log();
}

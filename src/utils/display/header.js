import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { printBanner } from "../banner.js";
import { ANSI } from "./formatters.js";

const DISPLAY_PKG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../package.json");
const DISPLAY_VERSION = JSON.parse(readFileSync(DISPLAY_PKG_PATH, "utf8")).version;

const BAR = `${ANSI.dim}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${ANSI.reset}`;

/**
 * Print task, configuration and pipeline header
 * @param {Object} params
 * @param {string} params.task
 * @param {Object} params.config
 */
export function printHeader({ task, config }) {
  const version = DISPLAY_VERSION;
  // Force banner: caller already gates on !jsonMode, so if we're here it's a human-readable run
  printBanner(version, { force: true });
  console.log(`${ANSI.bold}Task:${ANSI.reset} ${task}`);
  console.log(
    `${ANSI.bold}Coder:${ANSI.reset} ${config.roles?.coder?.provider || config.coder} ${ANSI.dim}|${ANSI.reset} ${ANSI.bold}Reviewer:${ANSI.reset} ${config.roles?.reviewer?.provider || config.reviewer}`
  );
  console.log(
    `${ANSI.bold}Max iterations:${ANSI.reset} ${config.max_iterations} ${ANSI.dim}|${ANSI.reset} ${ANSI.bold}Timeout:${ANSI.reset} ${config.session.max_total_minutes}min`
  );

  const pipeline = config.pipeline || {};
  const activeRoles = [];
  if (pipeline.planner?.enabled) activeRoles.push(`Planner (${config.roles?.planner?.provider || "?"})`);
  if (pipeline.researcher?.enabled) activeRoles.push(`Researcher (${config.roles?.researcher?.provider || "?"})`);
  if (pipeline.tester?.enabled) activeRoles.push("Tester");
  if (pipeline.security?.enabled) activeRoles.push("Security");
  if (pipeline.solomon?.enabled) {
    const solomonProvider = config.roles?.solomon?.provider;
    activeRoles.push(solomonProvider ? `Solomon (${solomonProvider})` : "Solomon");
  }
  if (activeRoles.length > 0) {
    const separator = ` ${ANSI.dim}|${ANSI.reset} `;
    console.log(`${ANSI.bold}Pipeline:${ANSI.reset} ${activeRoles.join(separator)}`);
  }

  console.log(BAR);
  console.log();
}

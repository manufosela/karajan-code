/**
 * KJC-TSK-1219 (ADR 0021, step 15d): kj init installs Karajan's kj-* commands into atril's
 * store under `.karajan/`, on demand (ADR 0021's default answer), instead of copying them into
 * `.claude/commands/`. With rulesync, `atril sync` takes the bridge and the router rule to every
 * CLI; without it nothing persistent is installed, and kj says how to get there.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { generate, install, sync } from "@karajan-family/atril";
import { ATRIL_ROOT } from "../skills/atril-skills.js";
import { detectRulesync } from "../utils/rulesync.js";
import { getTemplatesRoot } from "../utils/templates-root.js";

/**
 * @param {{ projectDir: string, logger: { info: Function, warn: Function }, env?: object, offerRulesync?: boolean }} opts
 *   offerRulesync false: the user declined rulesync (--no-rulesync), so kj does not suggest it again
 * @returns {{ installed: number, synced: boolean }}
 */
export function installKarajanCommands({ projectDir, logger, env = process.env, offerRulesync = true }) {
  const catalog = join(getTemplatesRoot(), "atril", "commands");
  const atril = { root: ATRIL_ROOT, projectDir, env };
  let installed = 0;
  let unchanged = 0;
  for (const file of readdirSync(catalog).filter((name) => name.endsWith(".md")).toSorted()) {
    try {
      // install() answers "installed" or "unchanged" (same content already there) and throws on a refusal.
      const { status } = install(join(catalog, file), { ...atril, kind: "command" });
      if (status === "installed") installed += 1;
      else unchanged += 1;
    } catch (err) {
      logger.warn(`kj: ${file} was not installed in ${ATRIL_ROOT}: ${err.message}`);
    }
  }
  logger.info(`kj: ${installed} Karajan command(s) installed in ${ATRIL_ROOT}/commands, on demand (${unchanged} already there)`);
  if (!detectRulesync(projectDir)) {
    if (offerRulesync) logger.info(`kj: to reach every CLI through /atril, run rulesync init and then atril sync --root ${ATRIL_ROOT}`);
    return { installed, synced: false };
  }
  try {
    for (const { action, path } of sync(atril).filter((step) => step.action !== "unchanged")) logger.info(`kj: atril ${action} .rulesync/${path}`);
    if (!generate(atril)) logger.info("kj: run rulesync generate to reach your agents, or declare rulesync.generate: true in .karajan/atril.json");
  } catch (err) {
    logger.warn(`kj: atril sync failed (${err.message}); fix it and run atril sync --root ${ATRIL_ROOT}`);
    return { installed, synced: false };
  }
  return { installed, synced: true };
}

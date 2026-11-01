/**
 * Lane setup (KJC-TSK-1371, #2852, step 6 of #2566): a lane `kj worktree start` creates is
 * ready on creation. Two things a fresh git worktree lacks, because git does not track them:
 * - the clone identity (.karajan/identity.local.yml), which the hooks read from the lane root
 *   so the identity lock knows who pushes; copied from the main checkout when it has one;
 * - the Sentinel wiring (.claude/settings.json hooks and .karajan/harness), installed in the
 *   lane with the same installers `kj harden` uses, so the first write there is governed.
 * A step that fails stops the start loudly, naming the step: never a half-set lane in silence.
 */
import fs from "node:fs";
import path from "node:path";

import { installSentinelHooks } from "../harden/sentinel-hooks.js";
import { installHarnessHooks } from "../harden/harness-hooks.js";

const IDENTITY = path.join(".karajan", "identity.local.yml");
const INSTALLERS = { sentinel: installSentinelHooks, harness: installHarnessHooks };

/** What setupLane writes into a lane (and the Sentinel's runtime state): never the lane's work. */
export const isLaneSetupPath = (p) => p === IDENTITY || p === path.join(".claude", "settings.json") || p.startsWith(path.join(".karajan", "harness") + path.sep);

/** A folder git lists whole (an ignored `.claude/`) is setup only when every file in it is. */
function onlySetup(lanePath, dir) {
  try {
    const files = fs.readdirSync(path.join(lanePath, dir), { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
    return files.every((d) => isLaneSetupPath(path.relative(lanePath, path.join(d.parentPath, d.name))));
  } catch {
    return false;
  }
}

/** `git status --porcelain` lines that are the lane's own work, setup files left out. */
export const laneWork = (porcelain, lanePath) => porcelain.split("\n").filter(Boolean).filter((line) => {
  const p = line.slice(3);
  return !(isLaneSetupPath(p) || (p.endsWith("/") && lanePath && onlySetup(lanePath, p)));
});

function step(name, fn) {
  try {
    return fn();
  } catch (err) {
    throw new Error(`lane setup failed at ${name}: ${err?.message || err}`, { cause: err });
  }
}

/** @returns {Promise<{ identity: boolean, wired: boolean }>} */
export async function setupLane({ mainDir, lanePath, logger = console, install = INSTALLERS }) {
  const source = path.join(mainDir, IDENTITY);
  const identity = step("the clone identity", () => {
    if (!fs.existsSync(source)) return false;
    fs.mkdirSync(path.join(lanePath, ".karajan"), { recursive: true });
    fs.copyFileSync(source, path.join(lanePath, IDENTITY));
    return true;
  });
  if (identity) logger.info?.(`  identity: ${IDENTITY} copied from the main checkout`);
  else logger.warn?.(`! no ${IDENTITY} in the main checkout: run kj identity set in the lane before pushing`);

  step("the Sentinel wiring", () => {
    const quiet = { info: () => {}, warn: (m) => logger.warn?.(m) };
    const results = [install.sentinel({ projectDir: lanePath, logger: quiet }), install.harness({ projectDir: lanePath, logger: quiet })];
    if (results.some((r) => !r?.wired)) throw new Error("the hooks were not wired (unreadable .claude/settings.json?)");
  });
  logger.info?.("  Sentinel: hooks wired in the lane");
  return { identity, wired: true };
}

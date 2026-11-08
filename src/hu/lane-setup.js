/**
 * Lane setup (KJC-TSK-1371, #2852, step 6 of #2566): a lane `kj worktree start` creates is
 * ready on creation. Three things a fresh git worktree lacks, because git does not track them:
 * - the clone identity (.karajan/identity.local.yml), which the hooks read from the lane root
 *   so the identity lock knows who pushes; copied from the main checkout when it has one;
 * - the Sentinel wiring (.claude/settings.json hooks and .karajan/harness), installed in the
 *   lane with the same installers `kj harden` uses, so the first write there is governed.
 * - the operator's local kj config (.karajan/kj.config.yml), copied only when git ignores it in the
 *   main checkout and in the lane (#3554): a tracked one is the branch's, never injected.
 * A step that fails stops the start loudly, naming the step: never a half-set lane in silence.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { installSentinelHooks } from "../harden/sentinel-hooks.js";
import { installHarnessHooks } from "../harden/harness-hooks.js";
import { mainCheckout } from "../utils/main-checkout.js";

const IDENTITY = path.join(".karajan", "identity.local.yml");
const LOCAL_CONFIG = path.join(".karajan", "kj.config.yml");
const INSTALLERS = { sentinel: installSentinelHooks, harness: installHarnessHooks };

/** What setupLane writes into a lane (and the Sentinel's runtime state): never the lane's work. */
// KJC-TSK-1444: the wiring lives in settings.local.json now; settings.json stays for lanes wired before.
export const isLaneSetupPath = (p) => p === IDENTITY || p === path.join(".claude", "settings.json") || p === path.join(".claude", "settings.local.json") || p.startsWith(path.join(".karajan", "harness") + path.sep);

/** The copy setupLane made: the lane's config still holds the main checkout's bytes. */
function inheritedConfig(lanePath) {
  const source = path.join(mainCheckout(lanePath), LOCAL_CONFIG);
  return fs.existsSync(source) && fs.readFileSync(path.join(lanePath, LOCAL_CONFIG)).equals(fs.readFileSync(source));
}

/** A file setupLane left in the lane; the local config only as its inherited copy, which git ignores. */
export const isLaneSetupFile = (lanePath, rel, ignored) => isLaneSetupPath(rel) || (ignored && rel === LOCAL_CONFIG && Boolean(lanePath) && inheritedConfig(lanePath));

/** A folder git lists whole (an ignored `.claude/`) is setup only when every file in it is. */
function onlySetup(lanePath, dir, ignored) {
  try {
    const files = fs.readdirSync(path.join(lanePath, dir), { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
    return files.every((d) => isLaneSetupFile(lanePath, path.relative(lanePath, path.join(d.parentPath, d.name)), ignored));
  } catch {
    return false;
  }
}

/** `git status --porcelain` lines that are the lane's own work, setup files left out. */
export const laneWork = (porcelain, lanePath) => porcelain.split("\n").filter(Boolean).filter((line) => {
  const p = line.slice(3);
  const ignored = line.startsWith("!! ");
  return !(isLaneSetupFile(lanePath, p, ignored) || (p.endsWith("/") && lanePath && onlySetup(lanePath, p, ignored)));
});

function step(name, fn) {
  try {
    return fn();
  } catch (err) {
    throw new Error(`lane setup failed at ${name}: ${err?.message || err}`, { cause: err });
  }
}

/** Whether git ignores the local config in `dir` (a tracked one never is); a git that cannot answer is loud. */
function gitIgnores(dir) {
  const r = spawnSync("git", ["-C", dir, "check-ignore", "-q", "--", LOCAL_CONFIG], { encoding: "utf8" });
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore failed in ${dir}: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.status === 0;
}

/** Copies the operator's config only when git ignores it on both sides; never over a lane file. */
function copyLocalConfig(mainDir, lanePath) {
  const source = path.join(mainDir, LOCAL_CONFIG);
  const target = path.join(lanePath, LOCAL_CONFIG);
  if (!fs.existsSync(source) || fs.existsSync(target) || !gitIgnores(mainDir) || !gitIgnores(lanePath)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

/** @returns {Promise<{ identity: boolean, config: boolean, wired: boolean }>} */
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

  const config = step("the local kj config", () => copyLocalConfig(mainDir, lanePath));
  if (config) logger.info?.(`  config: ${LOCAL_CONFIG} copied from the main checkout (git ignores it)`);

  step("the Sentinel wiring", () => {
    const quiet = { info: () => {}, warn: (m) => logger.warn?.(m) };
    const results = [install.sentinel({ projectDir: lanePath, logger: quiet }), install.harness({ projectDir: lanePath, logger: quiet })];
    if (results.some((r) => !r?.wired)) throw new Error("the hooks were not wired (unreadable .claude/settings.json?)");
  });
  logger.info?.("  Sentinel: hooks wired in the lane");
  return { identity, config, wired: true };
}

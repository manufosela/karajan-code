/**
 * KJC-TSK-1193 (ADR 0021, step 15e): `kj skills` hands atril's commands to atril's
 * own CLI, so every command atril grows reaches kj without touching kj, and the
 * contract between them stays narrow. The store is the project's `.karajan/`
 * unless the user names another root.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ATRIL_ROOT } from "./atril-skills.js";

export const ATRIL_COMMANDS = ["search", "route", "scan", "install", "remove", "graph", "enrich", "config"];

const ownsRoot = (args) => args.some((arg) => arg === "--root" || arg.startsWith("--root="));

/** The arguments atril gets: the user's, plus `--root .karajan` when they named none. */
export const atrilArgs = (action, args = []) => [action, ...args, ...(ownsRoot(args) ? [] : ["--root", ATRIL_ROOT])];

const INSTALL_HINT = "install it with npm i -g @karajan-family/atril, or install kj from npm (the single-file binary does not carry it)";

/**
 * The atril bin next to the package kj depends on. Fails loudly when there is
 * none: a kj without atril cannot pretend to manage the store.
 */
export function atrilBin(resolveFn = (spec) => import.meta.resolve(spec)) {
  let entry;
  try {
    entry = resolveFn("@karajan-family/atril");
  } catch (err) {
    throw new Error(`the atril CLI is not available here (${err.message}): ${INSTALL_HINT}`, { cause: err });
  }
  return fileURLToPath(new URL("../bin/atril.js", entry));
}

/** Runs atril with this node; its output is the user's, its exit code is kj's. */
export function runAtril({ action, args = [], spawn = spawnSync, bin = atrilBin(), exists = existsSync }) {
  if (spawn === spawnSync && !exists(bin)) throw new Error(`the atril CLI is not at ${bin}: ${INSTALL_HINT}`);
  const res = spawn(process.execPath, [bin, ...atrilArgs(action, args)], { stdio: "inherit" });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

/**
 * HU-3336 (epic #3332): the task manager board.yml names, loaded from its in-repo package.
 * Only the built-in names load. The name is matched against BUILT_IN before any path is
 * built, so a name read from a versioned file never reaches an import as text of its own.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { assertManager } from "../story-contract.js";

export const BUILT_IN = ["github", "linear"];
const PACKAGES = new URL("../../../packages/", import.meta.url);

/** The manager of the board config: `{ backend, repo }` or `{ backend, <backend>: block }`. */
export async function loadManager(boardConfig, { env = process.env, run, projectDir, board, packages = PACKAGES } = {}) {
  const { backend: name, ...rest } = boardConfig;
  if (!BUILT_IN.includes(name)) throw new Error(`unknown task manager "${name}": the built-in ones are ${BUILT_IN.join(", ")}`);
  const entry = new URL(`board-${name}/src/index.js`, packages);
  if (!fs.existsSync(fileURLToPath(entry))) throw new Error(`the manager package for ${name} is not installed`);
  const { createManager } = await import(/* @vite-ignore */ entry.href);
  if (typeof createManager !== "function") throw new TypeError(`the manager package for ${name} does not export createManager({ config, env, run })`);
  const manager = createManager({ config: rest[name] ?? rest, env, run, projectDir, board });
  assertManager(manager);
  return manager;
}

/**
 * HU-3336 (epic #3332): the task manager board.yml names, loaded from its in-repo package.
 * Only the built-in names load. The name is matched against BUILT_IN before any path is
 * built, so a name read from a versioned file never reaches an import as text of its own.
 */
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { assertManager } from "../story-contract.js";
import { parseAllow } from "./allowlist.js";

export const BUILT_IN = ["github", "linear"];
const PACKAGES = new URL("../../../packages/", import.meta.url);

const refuse = (reason, fix) => Object.assign(new Error(reason), { fix });

/** The installed copy's package.json: the nearest one above the resolved file that carries the package's name. */
function installedVersion(file, name) {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (pkg.name === name) return pkg.version;
  }
  return undefined;
}

/** A manager package listed in managers.allow: resolved from the project, version checked BEFORE it is imported. */
async function loadCommunity(name, allow, rest, { env, run, projectDir, board }) {
  const listed = allow.find((item) => item.backend === name);
  if (!listed) throw refuse(`unknown task manager "${name}": not in managers.allow (the built-in ones are ${BUILT_IN.join(", ")})`, "List the package in managers.allow of .karajan/board.yml through a pull request, or use a built-in manager");
  if (!projectDir) throw new TypeError(`the community manager ${listed.name} needs the project directory to be resolved from`);
  let file;
  try {
    file = createRequire(path.join(projectDir, "package.json")).resolve(listed.name);
  } catch (err) {
    if (err.code !== "MODULE_NOT_FOUND") throw refuse(`the community manager ${listed.name} cannot be resolved: ${err.code ?? err.message}`, `Check that ${listed.name}@${listed.version} is a valid installed package`);
    throw refuse(`the community manager ${listed.name} is not installed: install it yourself, kj never installs`, `Run: npm install --save-exact ${listed.name}@${listed.version}`);
  }
  const version = installedVersion(file, listed.name);
  if (version !== listed.version) throw refuse(`${listed.name} is installed at ${version ?? "an unknown version"} but managers.allow lists ${listed.version}: it was not run`, `Install exactly ${listed.name}@${listed.version}, or change managers.allow through a pull request`);
  const { createManager, credentials = [] } = await import(/* @vite-ignore */ pathToFileURL(file).href);
  if (typeof createManager !== "function") throw new TypeError(`the manager package ${listed.name} does not export createManager({ config, env, run })`);
  if (!Array.isArray(credentials) || !credentials.every((n) => typeof n === "string" && n !== "")) throw new TypeError(`${listed.name} must export credentials as a list of environment variable names`);
  const declared = Object.fromEntries(credentials.filter((n) => env[n] !== undefined).map((n) => [n, env[n]]));
  const manager = createManager({ config: rest[name] ?? rest, env: declared, run, projectDir, board });
  assertManager(manager);
  return Object.assign(manager, { credentials, source: { name: listed.name, version } });
}

/** The manager of the board config: `{ backend, repo }` or `{ backend, <backend>: block }`. */
export async function loadManager(boardConfig, { env = process.env, run, projectDir, board, packages = PACKAGES } = {}) {
  const { backend: name, managers, ...rest } = boardConfig;
  if (!BUILT_IN.includes(name)) return loadCommunity(name, parseAllow(managers), rest, { env, run, projectDir, board });
  const entry = new URL(`board-${name}/src/index.js`, packages);
  if (!fs.existsSync(fileURLToPath(entry))) throw new Error(`the manager package for ${name} is not installed`);
  const { createManager } = await import(/* @vite-ignore */ entry.href);
  if (typeof createManager !== "function") throw new TypeError(`the manager package for ${name} does not export createManager({ config, env, run })`);
  const manager = createManager({ config: rest[name] ?? rest, env, run, projectDir, board });
  assertManager(manager);
  return manager;
}

/**
 * Plugin dependencies (ADR 0021 decision 14, plan step 13g1-i): the plugins a manifest needs,
 * and the order to install a set of plugins in. Pure: it works on manifests the caller already
 * has. Matching is by name only; `marketplace` and `version` are carried, not checked.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readJson, SAFE_NAME } from "./plugin.js";

const fromString = (entry) => {
  const at = entry.lastIndexOf("@");
  return at < 0 ? { name: entry } : { name: entry.slice(0, at), marketplace: entry.slice(at + 1) };
};

const parseEntry = (entry) => {
  const { name, marketplace, version } = typeof entry === "string" ? fromString(entry) : entry ?? {};
  if (typeof name !== "string" || !SAFE_NAME.test(name)) throw new Error("the name must be lowercase letters, digits and dashes");
  if (marketplace !== undefined && !(typeof marketplace === "string" && SAFE_NAME.test(marketplace))) throw new Error("the marketplace must be lowercase letters, digits and dashes");
  if (version !== undefined && !(typeof version === "string" && version !== "")) throw new Error("the version must be a non-empty string");
  return { name, ...(marketplace !== undefined && { marketplace }), ...(version !== undefined && { version }) };
};

/** The `{ name, marketplace?, version? }` entries of a manifest's `dependencies`. */
export const pluginDependencies = (manifest) => {
  const list = manifest.dependencies;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("dependencies must be a list");
  return list.map((entry, i) => {
    try {
      return parseEntry(entry);
    } catch (e) {
      throw new Error(`dependencies[${i}] (${JSON.stringify(entry)}): ${e.message}`, { cause: e });
    }
  });
};

/** The names of `plugins` ({ name, manifest }[]), each one after every plugin it depends on. */
export const dependencyOrder = (plugins) => {
  const needs = new Map();
  for (const { name, manifest } of plugins) {
    if (needs.has(name)) throw new Error(`plugin "${name}" is listed twice`);
    try {
      needs.set(name, pluginDependencies(manifest).map((d) => d.name));
    } catch (e) {
      throw new Error(`${name}: ${e.message}`, { cause: e });
    }
  }
  const position = new Map([...needs.keys()].map((name, i) => [name, i]));
  const order = [];
  const done = new Set();
  const visit = (name, path) => {
    if (done.has(name)) return;
    if (path.includes(name)) throw new Error(`plugin dependency cycle: ${[...path.slice(path.indexOf(name)), name].join(" -> ")}`);
    for (const dep of needs.get(name)) {
      if (!needs.has(dep)) throw new Error(`${name} depends on ${dep}, which is not among the plugins to install`);
    }
    // Dependencies are visited in input order, so ties never depend on how a manifest lists them.
    for (const dep of [...needs.get(name)].sort((x, y) => position.get(x) - position.get(y))) visit(dep, [...path, name]);
    done.add(name);
    order.push(name);
  };
  for (const name of needs.keys()) visit(name, []);
  return order;
};

// ---- npm packages (plan step 13g1-ii): a plugin copy's own `package.json`, installed frozen. ----

const NPM_LOCKFILE = "package-lock.json";
const OTHER_LOCKFILES = ["bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml"];

/**
 * What installing a copy's npm packages needs, decided once for the install and the trust listing:
 * `none` (no runtime dependencies), `unsupported` (with the reason) or `ready` (with the lockfile).
 */
export const npmLockfile = (dir) => {
  const packageJson = join(dir, "package.json");
  if (!existsSync(packageJson)) return { status: "none" };
  const manifest = readJson(packageJson) ?? {};
  let count = 0;
  // `npm ci --omit=dev` installs both kinds, so both decide whether there is anything to install.
  for (const field of ["dependencies", "optionalDependencies"]) {
    const { [field]: packages = {} } = manifest;
    if (typeof packages !== "object" || packages === null || Array.isArray(packages)) {
      throw new Error(`${packageJson}: ${field} must be an object`);
    }
    count += Object.keys(packages).length;
  }
  if (count === 0) return { status: "none" };
  const lockfile = NPM_LOCKFILE;
  if (!existsSync(join(dir, lockfile))) {
    const other = OTHER_LOCKFILES.find((name) => existsSync(join(dir, name)));
    return { status: "unsupported", reason: other ? `${other}, not an npm lockfile` : "no lockfile" };
  }
  // npm >= 7 accepts a v1 lockfile and fills the missing metadata in from the registry: unpinned.
  const { lockfileVersion } = readJson(join(dir, lockfile));
  if (lockfileVersion !== 2 && lockfileVersion !== 3) {
    return { status: "unsupported", reason: `${lockfile} has lockfileVersion ${lockfileVersion}, not 2 or 3` };
  }
  return { status: "ready", lockfile };
};

export const defaultRun = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });

/**
 * Installs a copy's npm packages: `{ status: "none" | "unsupported" | "installed" }`. `npm ci` runs
 * in a staging folder beside the copy that holds only `package.json` and the lockfile, so the
 * plugin's own `.npmrc` is never read, and with `--ignore-scripts` no plugin code runs.
 */
export const installNpmDeps = (dir, { run = defaultRun } = {}) => {
  const found = npmLockfile(dir);
  if (found.status !== "ready") return found;
  const target = join(dir, "node_modules");
  if (existsSync(target)) throw new Error(`${target} already exists`);
  const staging = `${dir}.npm-${randomUUID()}`;
  try {
    mkdirSync(staging);
    for (const name of ["package.json", found.lockfile]) copyFileSync(join(dir, name), join(staging, name));
    try {
      run("npm", ["ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund"], staging);
    } catch (error) {
      throw new Error(`${dir}: npm ci failed (${error.message.slice(0, 500)})`, { cause: error });
    }
    if (!existsSync(join(staging, "node_modules"))) throw new Error(`${dir}: npm ci produced no node_modules`);
    renameSync(join(staging, "node_modules"), target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { status: "installed", lockfile: found.lockfile };
};

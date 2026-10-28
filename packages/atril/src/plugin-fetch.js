/**
 * Plugin fetch (ADR 0021, plan step 13a2-i): a git plugin at an explicit, pinned commit is
 * copied into <root>/plugins/<name>/<version>/ and its state recorded beside it in
 * <root>/plugins/<name>/state.json. Nothing is installed. A copy is never overwritten: it is
 * fetched into a staging folder, verified, and only then moved into place.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeAtomic } from "./atomic.js";
import { defaultGit, fetchInto } from "./fetch.js";
import { readJson, readPluginManifest, SAFE_NAME } from "./plugin.js";
import { parsePluginSource, pluginPaths } from "./plugin-source.js";
import { resolveRoot } from "./scan.js";

// Checked before the commit reaches git, so it can never be read as an option.
const COMMIT = /^[0-9a-f]{40}$/;

const urlOf = (source, gitBase) => (source.type === "github" ? `${gitBase}/${source.repo}.git` : source.url);

/**
 * @param {unknown} spec anything parsePluginSource accepts
 * @param {{ projectDir?: string, root?: string, env?: object, name?: string, commit?: string }} [opts]
 *   name: the name the caller expects; commit: the pin (else a 40-hex ref of the source)
 * @param {{ git?: (args: string[], cwd: string) => string, gitBase?: string }} [how]
 * @returns {{ name: string, version: string, commit: string, dir: string, status: "fetched" | "cached" }}
 */
export function fetchPlugin(spec, opts = {}, { git = defaultGit, gitBase = "https://github.com" } = {}) {
  const source = parsePluginSource(spec);
  if (source.type === "marketplace-url") throw new Error(`${source.url} is a marketplace, not a plugin`);
  if (source.type === "path") throw new Error(`${source.path}: local path sources are not supported yet`);
  const label = source.repo ?? source.url;
  const commit = opts.commit ?? source.ref;
  if (typeof commit !== "string" || !COMMIT.test(commit)) throw new Error(`${label}: needs a pinned commit of 40 hex characters`);

  const root = resolve(opts.projectDir ?? process.cwd(), resolveRoot(opts));
  const readState = (name) => {
    const path = join(root, "plugins", name, "state.json");
    return existsSync(path) ? readJson(path) : null;
  };
  const done = (state, status) => ({ name: state.name, version: state.version, commit, dir: pluginPaths(root, state.name, state.version).dir, status });

  const staging = join(root, "plugins", `.staging-${randomUUID()}`);
  try {
    if (opts.name !== undefined && !SAFE_NAME.test(opts.name)) throw new Error(`invalid plugin name: ${JSON.stringify(opts.name)}`);
    const known = opts.name && readState(opts.name);
    if (known?.commit === commit && existsSync(pluginPaths(root, known.name, known.version).dir)) return done(known, "cached");
    mkdirSync(join(root, "plugins"), { recursive: true });
    fetchInto(staging, urlOf(source, gitBase), commit, git);
    const { name, version = commit.slice(0, 12) } = readPluginManifest(staging);
    if (opts.name && opts.name !== name) throw new Error(`the plugin is named "${name}", not "${opts.name}"`);
    // state.json lives beside the version folders, so no version may take its name
    if (version === "state.json") throw new Error(`invalid plugin version: ${JSON.stringify(version)}`);
    const { base, dir } = pluginPaths(root, name, version);
    const state = { commit, name, source, version }; // keys sorted: the file only changes when the plugin does
    if (existsSync(dir)) {
      // state.json records the active copy only: another version's commit is unknown
      const current = readState(name);
      const held = current?.version === version ? current.commit : "an unknown commit";
      if (held !== commit) throw new Error(`${name}@${version} is cached at ${held}, not ${commit}`);
      return done(state, "cached");
    }
    mkdirSync(base, { recursive: true });
    renameSync(staging, dir);
    writeAtomic(join(base, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
    return done(state, "fetched");
  } catch (err) {
    throw new Error(`${label}: ${err.message}`, { cause: err });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Plugin fetch (ADR 0021, plan step 13a2-i): a git plugin at an explicit, pinned commit is
 * copied into <root>/plugins/<name>/<version>/ and its state recorded beside it in
 * <root>/plugins/<name>/state.json. Nothing is installed. A copy is never overwritten: it is
 * fetched into a staging folder, verified, and only then moved into place.
 */
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeAtomic } from "./atomic.js";
import { refuseLinks } from "./catalog-install.js";
import { defaultGit, fetchInto, SAFE } from "./fetch.js";
import { readJson, readPluginManifest, SAFE_NAME } from "./plugin.js";
import { parsePluginSource, pluginPaths } from "./plugin-source.js";
import { resolveRoot } from "./scan.js";

// Checked before the commit reaches git, so it can never be read as an option.
const COMMIT = /^[0-9a-f]{40}$/;

const urlOf = (source, gitBase) => (source.type === "github" ? `${gitBase}/${source.repo}.git` : source.url);

// What state.json records of a path source: never an absolute path, which would carry the home folder.
const portable = (project, path) => {
  const rel = relative(project, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? "local" : rel || ".";
};

// The commit of a ref (or HEAD): exactly one ref must match, and the answer must be a commit.
const lsRemote = (url, ref, git, cwd) => {
  const found = new Map(); // a peeled "^{}" line comes after its tag and holds the commit it points at
  // the peeled pattern is asked for too: an exact tag pattern does not match its "^{}" line
  for (const line of git([...SAFE, "ls-remote", url, ref, `${ref}^{}`], cwd).split("\n").filter(Boolean)) {
    const [sha, name = ""] = line.split(/\s+/);
    found.set(name.replace(/\^\{\}$/, ""), sha);
  }
  if (found.size !== 1) throw new Error(found.size ? `"${ref}" matches ${found.size} refs: ${[...found.keys()].join(", ")}` : `no commit matches "${ref}"`);
  const [sha] = found.values();
  if (!COMMIT.test(sha)) throw new Error(`the remote answered ${JSON.stringify(sha)}, not a commit`);
  return sha;
};

// opts.commit, then the marketplace sha, then a ref that is already a commit: all those given must agree.
// A branch or tag ref beside a pin is informational and is never resolved.
const pinOf = (source, opts, url, git, cwd) => {
  const pins = [["commit", opts.commit], ["sha", source.commit], ["ref", COMMIT.test(source.ref ?? "") ? source.ref : undefined]].filter(([, pin]) => pin !== undefined);
  if (!pins.length) return lsRemote(url, source.ref ?? "HEAD", git, cwd);
  const [[, commit]] = pins;
  if (typeof commit !== "string" || !COMMIT.test(commit)) throw new Error("needs a pinned commit of 40 hex characters");
  if (pins.some(([, pin]) => pin !== commit)) throw new Error(`the pins disagree: ${pins.map(([key, pin]) => `${key} ${pin}`).join(", ")}`);
  return commit;
};

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
  const label = source.type === "git-subdir" ? `${source.url} (${source.path})` : (source.repo ?? source.url ?? source.path);
  const project = resolve(opts.projectDir ?? process.cwd());
  const local = source.type === "path" ? resolve(project, source.path) : null; // cannot be pinned: copied on every call
  const root = resolve(project, resolveRoot(opts));
  const readState = (name) => {
    const path = join(root, "plugins", name, "state.json");
    return existsSync(path) ? readJson(path) : null;
  };
  const done = (state, status) => ({ name: state.name, version: state.version, commit: state.commit, dir: pluginPaths(root, state.name, state.version).dir, status });

  const staging = join(root, "plugins", `.staging-${randomUUID()}`);
  const old = `${staging}.old`;
  const repo = `${staging}.repo`; // a git-subdir checkout: only <path> of it is kept
  try {
    if (opts.name !== undefined && !SAFE_NAME.test(opts.name)) throw new Error(`invalid plugin name: ${JSON.stringify(opts.name)}`);
    if (local) refuseLinks(local);
    const url = urlOf(source, gitBase);
    const commit = local ? null : pinOf(source, opts, url, git, project);
    const known = commit && opts.name && readState(opts.name);
    if (known?.commit === commit && existsSync(pluginPaths(root, known.name, known.version).dir)) return done(known, "cached");
    mkdirSync(join(root, "plugins"), { recursive: true });
    if (local) {
      cpSync(local, staging, { recursive: true, filter: (path) => basename(path) !== ".git" });
      refuseLinks(staging); // a link planted after the first check never reaches the cache
    } else if (source.type === "git-subdir") {
      fetchInto(repo, url, commit, git);
      const from = join(repo, ...source.path.split("/")); // parsePluginSource only lets plain segments through
      if (!lstatSync(from, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${source.path} is not a folder at ${commit.slice(0, 12)}`);
      renameSync(from, staging); // a sibling folder: no copy
      refuseLinks(staging);
    } else fetchInto(staging, url, commit, git);
    const { name, version = commit?.slice(0, 12) ?? "local" } = readPluginManifest(staging);
    if (opts.name && opts.name !== name) throw new Error(`the plugin is named "${name}", not "${opts.name}"`);
    // state.json lives beside the version folders, so no version may take its name
    if (version === "state.json") throw new Error(`invalid plugin version: ${JSON.stringify(version)}`);
    const { base, dir } = pluginPaths(root, name, version);
    const state = { commit, name, source: local ? { type: "path", path: portable(project, local) } : source, version }; // keys sorted: the file only changes when the plugin does
    const current = existsSync(dir) ? readState(name) : null;
    const replaced = local && existsSync(dir);
    if (replaced && !(current?.version === version && current.commit === null)) throw new Error(`${name}@${version} is cached and is not a local copy`);
    if (!local && existsSync(dir)) {
      // state.json records the active copy only: another version's commit is unknown
      const held = current?.version === version ? current.commit : "an unknown commit";
      if (held !== commit) throw new Error(`${name}@${version} is cached at ${held}, not ${commit}`);
      return done(state, "cached");
    }
    if (replaced) renameSync(dir, old); // kept until the new copy and its state are in place
    try {
      mkdirSync(base, { recursive: true });
      renameSync(staging, dir);
      writeAtomic(join(base, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
    } catch (err) {
      if (replaced) {
        rmSync(dir, { recursive: true, force: true });
        renameSync(old, dir);
      }
      throw err;
    }
    return done(state, "fetched");
  } catch (err) {
    throw new Error(`${label}: ${err.message}`, { cause: err });
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(old, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}

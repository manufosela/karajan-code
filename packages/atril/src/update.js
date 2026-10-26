/**
 * Catalog updates (ADR 0031): the catalogs keep themselves current. catalogUpdates reports,
 * per git source, whether its repository has a newer commit than the pin and the diff of the
 * source's files between both, fetched into the cache like any pinned commit (no hook, no
 * symlink, commit verified). It moves nothing: the diff is for another AI to review first.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheRoot, catalogs, sourceDir } from "./catalog.js";
import { defaultGit, fetchInto, SAFE } from "./fetch.js";

const COMMIT = /^[0-9a-f]{40}$/;

// The diff between two cached folders; exit 1 only means they differ. No external diff tool runs.
function diffOf(cwd, from, to) {
  const res = spawnSync("git", ["diff", "--no-index", "--no-color", "--no-ext-diff", "--", from, to], { cwd, encoding: "utf8" });
  if (res.status !== 0 && res.status !== 1) throw new Error(`git diff failed (${res.stderr.trim()})`);
  return res.stdout;
}

/**
 * @param {{ projectDir?: string, root?: string, env?: object }} [opts]
 * @param {{ gitBase?: string, git?: (args: string[], cwd: string) => string }} [how] as in catalogSync
 * @returns {{ catalog: string, source: string, from: string, to: string, status: "current" | "outdated", diff?: string }[]}
 */
export function catalogUpdates(opts = {}, { gitBase = "https://github.com", git = defaultGit } = {}) {
  const projectDir = opts.projectDir ?? process.cwd();
  const found = [];
  for (const catalog of catalogs(opts).filter(({ type }) => type === "sources")) {
    for (const { source, commit } of catalog.sources) {
      const [owner, repo, ...path] = source.split("/");
      const url = `${gitBase}/${owner}/${repo}.git`;
      let latest;
      try {
        latest = git([...SAFE, "ls-remote", url, "HEAD"], projectDir).trim().split(/\s/)[0];
        if (!COMMIT.test(latest)) throw new Error("the remote names no HEAD commit");
        for (const sha of new Set([commit, latest])) {
          const target = sourceDir(opts, { source, commit: sha });
          if (existsSync(target)) continue;
          mkdirSync(dirname(target), { recursive: true });
          fetchInto(target, url, sha, git);
        }
      } catch (err) {
        throw new Error(`catalog "${catalog.ref}": ${source} could not be checked for updates (${err.message})`, { cause: err });
      }
      const entry = { catalog: catalog.ref, source, from: commit, to: latest };
      if (latest === commit) {
        found.push({ ...entry, status: "current" });
      } else {
        const diff = diffOf(join(cacheRoot(opts), owner, repo), join(commit, ...path), join(latest, ...path));
        found.push({ ...entry, status: "outdated", diff });
      }
    }
  }
  return found;
}

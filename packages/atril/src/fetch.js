/**
 * atril catalog sync (ADR 0021, decision 12; plan step 11b): every git source of the catalogs
 * is fetched into its cache folder (catalog.js `sourceDir`), at exactly its pinned commit, and
 * nothing is installed. A cached commit is immutable, so it is fetched once. The fetch happens
 * in a temporary folder renamed into place only once verified: a failure leaves nothing
 * behind. Symlinks are checked out as plain files and no hook runs.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { catalogs, sourceDir } from "./catalog.js";

const defaultGit = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
// Never a hook, never a symlink, never a detached-HEAD lecture.
const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.symlinks=false", "-c", "advice.detachedHead=false"];

function fetchInto(target, url, commit, git) {
  const temp = `${target}.${randomUUID()}.tmp`;
  mkdirSync(temp, { recursive: true });
  try {
    git([...SAFE, "init", "--quiet"], temp);
    git([...SAFE, "fetch", "--quiet", "--depth", "1", url, commit], temp);
    git([...SAFE, "checkout", "--quiet", "FETCH_HEAD"], temp);
    const head = git([...SAFE, "rev-parse", "HEAD"], temp).trim();
    if (head !== commit) throw new Error(`got ${head}, not the pinned commit`);
    rmSync(join(temp, ".git"), { recursive: true, force: true });
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { recursive: true, force: true });
    throw err;
  }
}

/**
 * @param {{ projectDir?: string, root?: string, env?: object }} [opts]
 * @param {{ gitBase?: string, git?: (args: string[], cwd: string) => string }} [how] where
 *   owner/repo lives (GitHub, as OpenSkills reads it) and how git runs; for tests
 * @returns {{ catalog: string, source: string, commit: string, status: "fetched" | "cached" }[]}
 */
export function catalogSync(opts = {}, { gitBase = "https://github.com", git = defaultGit } = {}) {
  const done = [];
  for (const catalog of catalogs(opts).filter(({ type }) => type === "sources")) {
    for (const { source, commit } of catalog.sources) {
      const target = sourceDir(opts, { source, commit });
      const status = existsSync(target) ? "cached" : "fetched";
      if (status === "fetched") {
        const [owner, repo] = source.split("/");
        mkdirSync(dirname(target), { recursive: true });
        try {
          fetchInto(target, `${gitBase}/${owner}/${repo}.git`, commit, git);
        } catch (err) {
          throw new Error(`catalog "${catalog.ref}": ${source}@${commit.slice(0, 12)} could not be fetched (${err.message})`, { cause: err });
        }
      }
      done.push({ catalog: catalog.ref, source, commit, status });
    }
  }
  return done;
}

/**
 * Derive a sensible default project name from the working directory,
 * trying several signals in order:
 *
 *   1. `package.json` "name" field (most authoritative — that's what
 *      the user already chose for their npm/pnpm project).
 *   2. Git remote URL basename (strip protocol, user, `.git` suffix —
 *      e.g. `git@github.com:foo/weather-dashboard.git` → `weather-dashboard`).
 *   3. The cwd directory basename.
 *
 * Any of these is then prettified: kebab/snake → spaces, words
 * capitalised. So `weather-dashboard` becomes `Weather Dashboard`.
 *
 * Returns null when no signal yields anything useful — caller can then
 * fall back to its old "derive from task text" heuristic. This keeps
 * the function pure / sync-friendly even though git/fs lookups are
 * sync — they're cheap on a single-shot CLI startup.
 *
 * Why this matters: pre-fix, running `kj plan generate --task-file
 * SPEC.md` inside `~/ws_demo/weather-dashboard` (an initialised git
 * repo) suggested a project name made from the words of the SPEC's
 * first sentence. That ignored both the directory the user was
 * standing in and the repo they had just `git init`-ed. The right
 * default is "the project I'm in", not "the topic of the document
 * I just wrote".
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Turn `weather-dashboard` / `weather_dashboard` / `WeatherDashboard`
 * into `Weather Dashboard`. Preserves single-token names as-is when
 * already title-cased.
 */
function prettifyName(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Insert space at camelCase boundaries, then split on -/_/whitespace.
  const spaced = trimmed
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!spaced) return null;
  return spaced
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function readPackageJsonName(cwd) {
  try {
    const pkgPath = path.join(cwd, "package.json");
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (typeof pkg.name === "string" && pkg.name.trim()) {
      // Strip npm scope if present: @org/name → name
      const unscoped = pkg.name.includes("/") ? pkg.name.split("/").pop() : pkg.name;
      return unscoped;
    }
    return null;
  } catch {
    return null;
  }
}

function readGitRemoteBasename(cwd) {
  try {
    // -C points git at the cwd without us cd'ing the process.
    // Audit follow-up: was using execSync with template-string interpolation
    // of `cwd`. Switched to execFileSync with arg arrays so no interpolation
    // reaches /bin/sh.
    const out = execFileSync("git", ["-C", String(cwd), "config", "--get", "remote.origin.url"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1500,
    }).trim();
    if (!out) return null;
    // Strip optional protocol + user, .git suffix, trailing slash.
    // Examples:
    //   git@github.com:foo/weather-dashboard.git
    //   https://github.com/foo/weather-dashboard
    //   git@gitlab.com:team/weather-dashboard
    const last = out.replace(/\.git\/?$/, "").split(/[/:]/).pop();
    return last || null;
  } catch {
    return null;
  }
}

function readCwdBasename(cwd) {
  const base = path.basename(cwd || process.cwd());
  if (!base || base === "/" || base === ".") return null;
  return base;
}

/**
 * Try every signal in priority order and return the first prettified
 * non-empty result. Returns null when nothing useful is available.
 *
 * @param {string} [cwd] — defaults to process.cwd()
 * @returns {string|null}
 */
export function deriveProjectNameFromCwd(cwd = process.cwd()) {
  const fromPkg = prettifyName(readPackageJsonName(cwd));
  if (fromPkg) return fromPkg;
  const fromGit = prettifyName(readGitRemoteBasename(cwd));
  if (fromGit) return fromGit;
  const fromCwd = prettifyName(readCwdBasename(cwd));
  if (fromCwd) return fromCwd;
  return null;
}

// Exposed for unit tests so they can drive the individual signals
// without real filesystem / git side-effects.
export const __test__ = { prettifyName, readPackageJsonName, readGitRemoteBasename, readCwdBasename };

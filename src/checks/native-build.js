/**
 * Native module check (KJC-BUG-0092, KJC-TSK-1353).
 *
 * node-pty is kj's only native module since better-sqlite3 left (KJC-TSK-1353:
 * every SQLite store runs on node:sqlite, built into Node). It is optional: it
 * powers the HU Board's terminal. Where it needs its install script, pnpm
 * (ERR_PNPM_IGNORED_BUILDS) and npm 12 (allowScripts) block it by default, so
 * `kj doctor` warns with the exact remedy instead of a broken terminal.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STRATEGY } from "./types.js";

// kj's own package root: where npm keeps its dependencies' approvals and builds.
const OWN_PKG_DIR = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** npm's major version, or null when npm is not there to ask. */
function defaultNpmMajor() {
  try {
    return Number.parseInt(execFileSync("npm", ["--version"], { encoding: "utf8", timeout: 10_000 }), 10) || null;
  } catch {
    return null;
  }
}

/**
 * KJC-BUG-0426 (issue #2670): npm 12 runs a dependency's install script only when
 * allowScripts covers it; reinstalling blocks it again. Approve, then rebuild, in kj's dir.
 */
export const npmAllowScriptsRemedy = (pkgDir = OWN_PKG_DIR) =>
  `cd "${pkgDir}" && npm install-scripts approve node-pty && npm rebuild node-pty`;

/** pnpm lays packages out under a `.pnpm` virtual store and symlinks them in. */
function isPnpmInstall() {
  return (
    import.meta.url.includes("/.pnpm/") ||
    (process.env.npm_config_user_agent || "").includes("pnpm")
  );
}

/** Load node-pty's native binding. */
async function defaultLoadPty() {
  await import("node-pty");
}

const NO_TERMINAL = "the HU Board terminal is unavailable (everything else works)";

export function createNativeBuildCheck({ loadPty = defaultLoadPty, isPnpm = isPnpmInstall, npmMajor = defaultNpmMajor, pkgDir = OWN_PKG_DIR } = {}) {
  return {
    name: "native-build",
    label: "native modules (node-pty)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      try {
        await loadPty();
        return { ok: true, severity: "info", detail: "node-pty loads — the HU Board terminal is available" };
      } catch (err) {
        const firstLine = String(err?.message || err).split("\n")[0];
        if (isPnpm()) {
          return {
            ok: false,
            severity: "warn",
            detail: `node-pty native build was skipped — pnpm blocks dependency build scripts by default; ${NO_TERMINAL}`,
            fix: "Approve the build then reinstall: `pnpm approve-builds node-pty` — or install with npm: `npm i -g @karajan-family/code`",
          };
        }
        if ((npmMajor() ?? 0) >= 12) {
          return {
            ok: false,
            severity: "warn",
            detail: `node-pty failed to load: ${firstLine} — npm 12 skips dependency install scripts that allowScripts does not cover; ${NO_TERMINAL}`,
            fix: npmAllowScriptsRemedy(pkgDir),
          };
        }
        return {
          ok: false,
          severity: "warn",
          // KJC-BUG-0118: the standalone (curl) binary ships without native modules by design.
          detail: `node-pty failed to load: ${firstLine} — ${NO_TERMINAL}; the standalone binary does not bundle native modules`,
          fix: "Reinstall to rebuild native modules: `npm i -g @karajan-family/code`",
        };
      }
    },
  };
}

export function getNativeBuildChecks() {
  return [createNativeBuildCheck()];
}

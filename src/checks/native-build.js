/**
 * Native build availability check (KJC-BUG-0092).
 *
 * better-sqlite3 ships a native addon compiled in a postinstall step. pnpm
 * blocks dependency build scripts by default (ERR_PNPM_IGNORED_BUILDS), so a
 * `pnpm add -g karajan-code` leaves the addon uncompiled: `kj --version` still
 * works (it never opens a DB) but any DB-backed command (board, rag, cost
 * tracking) crashes with "Cannot find module 'better-sqlite3'". This surfaces a
 * WARN in `kj doctor` with the exact remedy instead of a cryptic runtime crash.
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
  `cd "${pkgDir}" && npm install-scripts approve better-sqlite3 && npm install-scripts approve node-pty && npm rebuild better-sqlite3 node-pty`;

// The addon is installed but its native build is missing (a missing package needs a reinstall, not this).
const UNBUILT_ADDON = /bindings file|better_sqlite3\.node/;

/** A missing better-sqlite3 addon becomes an error that says how to build it; any other error passes as it is. */
export function explainNativeLoadError(err, { npmMajor = defaultNpmMajor, pkgDir = OWN_PKG_DIR } = {}) {
  if (!UNBUILT_ADDON.test(String(err?.message ?? err))) return err;
  const remedy = (npmMajor() ?? 0) >= 12
    ? `npm 12 skipped its install script (allowScripts); build it with: ${npmAllowScriptsRemedy(pkgDir)}`
    : "run kj doctor for the exact fix on this install";
  return new Error(`better-sqlite3 native addon is not built, so the RAG cannot open its index — ${remedy}`, { cause: err });
}

/** pnpm lays packages out under a `.pnpm` virtual store and symlinks them in. */
function isPnpmInstall() {
  return (
    import.meta.url.includes("/.pnpm/") ||
    (process.env.npm_config_user_agent || "").includes("pnpm")
  );
}

/** Force the native binding to load by opening an in-memory database. */
async function defaultLoadDb() {
  const Database = (await import("better-sqlite3")).default;
  new Database(":memory:").close();
}

export function createNativeBuildCheck({ loadDb = defaultLoadDb, isPnpm = isPnpmInstall, npmMajor = defaultNpmMajor, pkgDir = OWN_PKG_DIR } = {}) {
  return {
    name: "native-build",
    label: "native modules (better-sqlite3)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      try {
        await loadDb();
        return {
          ok: true,
          severity: "info",
          detail: "better-sqlite3 native addon loads — DB-backed commands available",
        };
      } catch (err) {
        const firstLine = String(err?.message || err).split("\n")[0];
        if (isPnpm()) {
          return {
            ok: false,
            severity: "warn",
            detail: "better-sqlite3 native build was skipped — pnpm blocks dependency build scripts by default",
            fix: "Approve the build then reinstall: `pnpm approve-builds better-sqlite3` — or install with npm: `npm i -g @karajan-family/code`",
          };
        }
        if ((npmMajor() ?? 0) >= 12) {
          return {
            ok: false,
            severity: "warn",
            detail: `better-sqlite3 failed to load: ${firstLine} — npm 12 skips dependency install scripts that allowScripts does not cover, so the native build never ran`,
            fix: npmAllowScriptsRemedy(pkgDir),
          };
        }
        return {
          ok: false,
          severity: "warn",
          // KJC-BUG-0118: the standalone (curl) binary ships without native
          // modules by design — name the consequence (RAG/board/MCP need the
          // npm install) instead of implying the install is broken.
          detail: `better-sqlite3 failed to load: ${firstLine} — DB-backed features (RAG, board, MCP) unavailable; the standalone binary does not bundle native modules`,
          fix: "Reinstall to rebuild native modules: `npm i -g @karajan-family/code`",
        };
      }
    },
  };
}

export function getNativeBuildChecks() {
  return [createNativeBuildCheck()];
}

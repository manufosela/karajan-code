/**
 * esbuild configuration for Node.js SEA (Single Executable Application) bundle.
 *
 * Bundles the entire CLI into a single CJS file suitable for SEA injection.
 * A plugin handles:
 *   1. import.meta.url / import.meta.dirname -> CJS equivalents
 *   2. Top-level await in cli.js -> async IIFE wrapper
 *   3. Runtime package.json reads -> inlined version string
 */

import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG_VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const seaTransformPlugin = {
  name: "sea-transform",
  setup(build) {
    // Only process real files. Imports redirected by hu-board-stub (or any
    // other namespaced plugin) MUST not pass through this transform —
    // their `args.path` is a virtual id, not a path readFile can open.
    build.onLoad({ filter: /\.m?js$/, namespace: "file" }, async (args) => {
      let contents = await fs.readFile(args.path, "utf8");
      let modified = false;

      // Replace import.meta.dirname with __dirname
      if (contents.includes("import.meta.dirname")) {
        contents = contents.replaceAll("import.meta.dirname", "__dirname");
        modified = true;
      }

      // Replace import.meta.url with CJS equivalent
      if (contents.includes("import.meta.url")) {
        contents = contents.replaceAll(
          "import.meta.url",
          'require("node:url").pathToFileURL(__filename).href'
        );
        modified = true;
      }

      // Inline version: replace any pattern that reads ../../package.json or ../package.json
      // to extract the version, with the hardcoded version string.
      // Covers cli.js, display.js, doctor.js, bootstrap.js, init.js, server.js
      if (contents.includes("package.json") && contents.match(/["']\.\.\/.*package\.json/)) {
        // Pattern: const X = path.resolve(..., "../../package.json");
        //          const Y = JSON.parse(readFileSync(X, "utf8")).version;
        // Replace both lines with: const Y = "1.57.0";
        contents = contents.replace(
          /const (\w+) = (?:path\.resolve|resolve)\(.*?["']\.\.\/.*?package\.json["']\);\s*\n\s*(?:const|return) (\w+) = JSON\.parse\(.*?readFileSync\(\1.*?\).*?\.version;/g,
          `const $2 = ${JSON.stringify(PKG_VERSION)};`
        );
        // Single-line pattern: return JSON.parse(readFileSync(pkgPath...)).version
        contents = contents.replace(
          /const (\w+) = (?:path\.resolve|resolve)\(.*?["']\.\.\/.*?package\.json["']\);\s*\n\s*return JSON\.parse\(.*?readFileSync\(\1.*?\).*?\.version;/g,
          `return ${JSON.stringify(PKG_VERSION)};`
        );
        // Pattern in cli.js: const PKG_PATH = ...; const PKG_VERSION = ...;
        contents = contents.replace(
          /const PKG_PATH = .*?package\.json.*?;\s*\nconst PKG_VERSION = .*?\.version;/,
          `const PKG_VERSION = ${JSON.stringify(PKG_VERSION)};`
        );
        // Pattern in display.js: const DISPLAY_PKG_PATH = ...; const DISPLAY_VERSION = ...;
        contents = contents.replace(
          /const DISPLAY_PKG_PATH = .*?package\.json.*?;\s*\nconst DISPLAY_VERSION = .*?\.version;/,
          `const DISPLAY_VERSION = ${JSON.stringify(PKG_VERSION)};`
        );
        // Pattern in server.js: const PKG_PATH = ...; (used later to read version)
        contents = contents.replace(
          /const PKG_PATH = .*?package\.json.*?;\s*\nconst PKG = JSON\.parse\(readFileSync\(PKG_PATH.*?\)\);/,
          `const PKG = { version: ${JSON.stringify(PKG_VERSION)}, name: "karajan-code" };`
        );
        modified = true;
      }

      // Wrap top-level await in cli.js inside an async IIFE
      if (args.path.endsWith("src/cli.js") || args.path.endsWith("src\\cli.js")) {
        contents = contents.replace(
          /^(try\s*\{[\s\S]*?await\s+program\.parseAsync\(\)[\s\S]*?^\})\s*$/m,
          "(async () => {\n$1\n})();"
        );
        modified = true;
      }

      return modified ? { contents, loader: "js" } : undefined;
    });
  }
};

/**
 * Stub plugin for the HU Board package (KJC-BUG-0040).
 *
 * The HU Board lives in `packages/hu-board/` and requires `better-sqlite3`
 * — a native node-gyp module that esbuild cannot resolve at bundle time
 * (it has no JS entry point, only `.node` binaries compiled per platform).
 *
 * The SEA binary is the lean CLI distribution. Users who want the HU
 * Board install via `npm install -g karajan-code`, which installs
 * better-sqlite3 normally. So the right answer is: do NOT include
 * `packages/hu-board/` in the SEA bundle at all.
 *
 * This plugin intercepts every import / dynamic import that points into
 * `packages/hu-board/src/*` and rewrites it to a stub module that throws
 * a clear, actionable error when invoked at runtime — instead of failing
 * silently during bundling.
 */
const huBoardStubPlugin = {
  name: "hu-board-stub",
  setup(build) {
    build.onResolve({ filter: /packages[\\/]hu-board[\\/]src[\\/].*/ }, (args) => ({
      path: args.path,
      namespace: "hu-board-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "hu-board-stub" }, () => ({
      contents: `
        const NOT_AVAILABLE = "The HU Board is not available in this standalone binary.\\n" +
          "Install karajan-code from npm to get the dashboard:\\n" +
          "  npm install -g karajan-code\\n";
        function notAvailable() { throw new Error(NOT_AVAILABLE); }
        // Explicit named exports for every symbol the CLI imports from
        // hu-board. Adding them by name (rather than relying on a Proxy)
        // avoids esbuild's CJS↔ESM interop confusion: a Proxy that
        // returns truthy for "__esModule" makes esbuild wrap the import
        // and the destructured names resolve to undefined.
        module.exports = {
          __esModule: false,
          initDb: notAvailable,
          closeDb: notAvailable,
          cleanupZombies: notAvailable,
          // Catch-all default so \`import foo from\` and \`import * as foo\`
          // also throw the same message instead of returning undefined.
          default: notAvailable,
        };
      `,
      loader: "js",
    }));
  },
};

/** @type {import('esbuild').BuildOptions} */
export const seaBuildOptions = {
  entryPoints: ["src/cli.js"],
  outfile: "dist/kj-bundle.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
  bundle: true,
  minify: false,
  // better-sqlite3 is a native module imported by packages/hu-board/src/db.js.
  // The hu-board-stub plugin below replaces the whole hu-board package so
  // this `external` entry is belt-and-braces — if any other dependency
  // pulls better-sqlite3 in we want a clear "not bundled" error, not a
  // silent half-bundle.
  //
  // madge (KJC-TSK v2.17): pulled in by src/audit/circular-deps.js via a
  // dynamic import. Madge transitively depends on @vue/compiler-sfc which
  // optionally requires ~20 template engines (velocityjs, dustjs-linkedin,
  // twig, …) that are not installed — esbuild fails the bundle if it
  // tries to walk those. Marking madge external keeps `kj audit` working
  // in npm-installed Karajan (madge is in node_modules) and degrades
  // gracefully in the SEA binary (the dynamic import fails → audit
  // continues without circular-dep findings).
  // knip (KJC-TSK v2.17): invoked as a subprocess by src/audit/dead-exports.js
  // via `process.execPath knip-bin --reporter json`. Its native parser
  // (oxc-parser, oxc-resolver) and CLI machinery must not be bundled. In SEA
  // builds the createRequire(import.meta.url).resolve("knip/bin/knip.js")
  // throws → collector returns available:false. npm installs get knip
  // resolved normally from node_modules.
  external: ["better-sqlite3", "madge", "knip", "oxc-parser", "oxc-resolver"],
  plugins: [seaTransformPlugin, huBoardStubPlugin],
  logLevel: "info",
};

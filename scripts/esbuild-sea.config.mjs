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
import { readFileSync, readdirSync } from "node:fs";
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

// Same reasoning as the HU Board stub: src/rag/* + src/commands/rag.js
// depend on better-sqlite3 + sqlite-vec, native modules that esbuild
// cannot bundle. The SEA binary stubs them out and tells the user to
// install via npm to get RAG. KJC-PCS-0049 / Step 6.
const ragStubPlugin = {
  name: "rag-stub",
  setup(build) {
    // KJC-TSK-0704 — src/privacy/* rides this stub too: its engine is redactPII.
    build.onResolve({ filter: /[\\/](rag[\\/].+|privacy[\\/].+|commands[\\/](rag|watch|privacy))\.js$/ }, (args) => ({
      path: args.path, namespace: "rag-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "rag-stub" }, () => ({
      contents: `
        const NOT_AVAILABLE = "The RAG subsystem is not available in this standalone binary.\\n" +
          "Install karajan-code from npm to get \\\`kj rag\\\`:\\n" +
          "  npm install -g karajan-code\\n";
        function notAvailable() { throw new Error(NOT_AVAILABLE); }
        module.exports = {
          __esModule: false,
          ragIndexCommand: notAvailable, ragQueryCommand: notAvailable,
          openVecStore: notAvailable, OllamaEmbedder: notAvailable,
          indexFile: notAvailable, indexProject: notAvailable,
          query: notAvailable, chunkMarkdown: notAvailable, chunkPlan: notAvailable, chunkSource: notAvailable,
          // KJC-TSK-0435 — Ollama Docker manager.
          ollamaUp: notAvailable, ollamaDown: notAvailable, ensureComposeFile: notAvailable,
          isOllamaReachable: notAvailable, findAvailableOllamaPort: notAvailable,
          waitForOllamaReady: notAvailable, buildComposeTemplate: notAvailable, normalizeOllamaConfig: notAvailable,
          // KJC-TSK-0436 — Ollama capability check + model pull.
          checkDockerAvailable: notAvailable, checkRamCapacity: notAvailable,
          checkOllamaCapability: notAvailable, pullOllamaModel: notAvailable,
          // KJC-TSK-0438 — RAG project isolation.
          projectSlug: notAvailable,
          // KJC-TSK-0441 — RAG chokidar watcher.
          startWatcher: notAvailable, readPidFile: notAvailable, clearPidFile: notAvailable,
          isPidAlive: notAvailable, writePidFile: notAvailable,
          // KJC-TSK-0442 / KJC-TSK-0446 — RAG embedders cloud + factory.
          makeEmbedder: notAvailable, OpenAIEmbedder: notAvailable, VoyageEmbedder: notAvailable,
          OpenAIEmbedderError: notAvailable, VoyageEmbedderError: notAvailable, PROVIDERS: notAvailable,
          CohereEmbedder: notAvailable, CohereEmbedderError: notAvailable,
          MistralEmbedder: notAvailable, MistralEmbedderError: notAvailable,
          ONNXEmbedder: notAvailable, ONNXEmbedderError: notAvailable,
          // KJC-TSK-0448 — RAG --where metadata filter.
          parseWhere: notAvailable, buildWhereSql: notAvailable,
          // KJC-TSK-0449 — RAG cross-encoder rerank.
          rerank: notAvailable, RerankError: notAvailable, _resetPipeline: notAvailable,
          // KJC-BUG-0097 — src/rag/auto-update.js lives under src/rag/ so it is
          // caught by this stub, but its exports are called on the hot path.
          // maybeAutoUpdate() runs on EVERY \`kj run\` (run.js): it must be a
          // silent no-op here (RAG index is unavailable in SEA anyway), NOT an
          // absent symbol — otherwise the whole command crashes with
          // "maybeAutoUpdate is not a function". installPostMergeHook() is only
          // reached from \`kj rag install-hooks\`, so it degrades like the rest.
          maybeAutoUpdate: async () => ({ skipped: true }),
          installPostMergeHook: notAvailable,
          // KJC-TSK-0704 — privacy scan (engine = karajan-rag redactPII).
          privacyScanCommand: notAvailable, loadPrivacyList: notAvailable,
          scanText: notAvailable, scanPaths: notAvailable, privacyConfigPath: notAvailable,
          // KJC-BUG-0100 — the doctor rag-hooks check imports this; it throws
          // here and the check swallows it (degrades to a benign info result).
          resolveHooksDir: notAvailable,
          default: notAvailable,
        };
      `,
      loader: "js",
    }));
  },
};

// KJC-TSK-0472 — audit-history sqlite stub (same reasoning as rag/hu-board stubs).
const auditHistoryStubPlugin = {
  name: "audit-history-stub",
  setup(b) {
    b.onResolve({ filter: /[\\/]audit[\\/]audit-history\.js$/ }, (a) => ({ path: a.path, namespace: "ahs" }));
    b.onLoad({ filter: /.*/, namespace: "ahs" }, () => ({ contents: "module.exports = { __esModule: false, persistAuditRun: () => ({ ok: false, error: 'history disabled in SEA' }), getAuditHistoryDbPath: () => null, openAuditHistoryDb: () => null, recordAuditRun: () => null, listRecentRuns: () => [], countRuns: () => 0, pruneOldRuns: () => 0, getLatestPreviousRun: () => null, getRecentScores: () => [] };", loader: "js" }));
  },
};

/** @type {import('esbuild').BuildOptions} */
/**
 * List every built-in template file, as paths relative to templates/
 * (KJC-BUG-0104). The SEA binary ships them as SEA assets — build-sea.mjs
 * turns this list into the sea-config `assets` map plus an index the
 * runtime (src/utils/templates-root.js) uses to extract them on first use.
 * Exported (instead of living in build-sea.mjs, which runs main() on
 * import) so tests can exercise it.
 */
export function collectTemplateFiles(rootDir = path.join(ROOT, "templates")) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else files.push(path.relative(rootDir, p));
    }
  };
  walk(rootDir);
  return files.sort();
}

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
  plugins: [seaTransformPlugin, huBoardStubPlugin, ragStubPlugin, auditHistoryStubPlugin],
  logLevel: "info",
};

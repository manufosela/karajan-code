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
    build.onLoad({ filter: /\.m?js$/ }, async (args) => {
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

/** @type {import('esbuild').BuildOptions} */
export const seaBuildOptions = {
  entryPoints: ["src/cli.js"],
  outfile: "dist/kj-bundle.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
  bundle: true,
  minify: false,
  external: [],
  plugins: [seaTransformPlugin],
  logLevel: "info",
};

/**
 * esbuild configuration for Node.js SEA (Single Executable Application) bundle.
 *
 * Bundles the entire CLI into a single CJS file suitable for SEA injection.
 * SEA requires CJS format — ESM entry points are transpiled by esbuild.
 */

/** @type {import('esbuild').BuildOptions} */
export const seaBuildOptions = {
  entryPoints: ["src/cli.js"],
  outfile: "dist/kj-bundle.cjs",
  format: "cjs",
  platform: "node",
  target: "node20",
  bundle: true,
  minify: false,
  // Bundle everything — no externals. The binary must be fully self-contained.
  external: [],
  // Shim for CJS compatibility in the SEA context.
  banner: {
    js: [
      "/* Karajan Code — SEA bundle */",
      "/* eslint-disable */",
      'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
    ].join("\n"),
  },
  // Replace import.meta.url references with the CJS-compatible shim variable.
  define: {
    "import.meta.url": "__importMetaUrl",
  },
  // Log level for debugging build issues.
  logLevel: "info",
};

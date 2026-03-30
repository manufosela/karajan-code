#!/usr/bin/env node

/**
 * build-sea.mjs — Build a Node.js Single Executable Application (SEA) binary.
 *
 * Steps:
 *   1. esbuild bundles src/cli.js -> dist/kj-bundle.cjs (CJS, all deps inlined)
 *   2. Generate SEA preparation blob via node --experimental-sea-config
 *   3. Copy the current node binary to dist/kj (or dist/kj.exe on Windows)
 *   4. Inject the blob into the binary with postject
 *   5. (macOS only) Re-sign the binary with ad-hoc signature
 *
 * Requirements (installed globally or via npx):
 *   - esbuild
 *   - postject
 *
 * Usage:
 *   node scripts/build-sea.mjs
 */

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const binaryName = isWindows ? "kj.exe" : "kj";
const binaryPath = path.join(DIST, binaryName);

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

async function main() {
  try {
    console.log("\n=== Karajan Code — SEA Build ===\n");

    // ── Step 0: Prepare dist directory ──────────────────────────────
    mkdirSync(DIST, { recursive: true });

    // ── Step 1: Bundle with esbuild ─────────────────────────────────
    console.log("[1/5] Bundling with esbuild...");
    const { seaBuildOptions } = await import("./esbuild-sea.config.mjs");
    const esbuild = await import("esbuild");
    await esbuild.build(seaBuildOptions);
    console.log("      -> dist/kj-bundle.cjs created.\n");

    // ── Step 2: Generate SEA blob ───────────────────────────────────
    console.log("[2/5] Generating SEA preparation blob...");
    const seaConfig = {
      main: "dist/kj-bundle.cjs",
      output: "dist/sea-prep.blob",
      disableExperimentalSEAWarning: true,
    };
    writeFileSync(
      path.join(DIST, "sea-config.json"),
      JSON.stringify(seaConfig, null, 2),
    );
    run("node --experimental-sea-config dist/sea-config.json");
    console.log("      -> dist/sea-prep.blob created.\n");

    // ── Step 3: Copy node binary ────────────────────────────────────
    console.log("[3/5] Copying node binary...");
    cpSync(process.execPath, binaryPath);
    console.log(`      -> ${binaryName} copied.\n`);

    // ── Step 3.5: Remove signature on macOS (required before postject)
    if (isMac) {
      console.log("[3.5] Removing macOS code signature...");
      run(`codesign --remove-signature ${binaryPath}`);
      console.log("      -> Signature removed.\n");
    }

    // ── Step 4: Inject blob with postject ───────────────────────────
    console.log("[4/5] Injecting SEA blob with postject...");
    const postjectCmd = [
      `npx postject ${binaryPath}`,
      "NODE_SEA_BLOB dist/sea-prep.blob",
      "--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ].join(" ");
    run(postjectCmd);
    console.log("      -> Blob injected.\n");

    // ── Step 4.5: Re-sign on macOS ──────────────────────────────────
    if (isMac) {
      console.log("[4.5] Re-signing binary (ad-hoc)...");
      run(`codesign --sign - ${binaryPath}`);
      console.log("      -> Binary signed.\n");
    }

    // ── Done ────────────────────────────────────────────────────────
    const stat = statSync(binaryPath);
    console.log("[5/5] Done!");
    console.log(`      Binary: ${binaryPath}`);
    console.log(`      Size:   ${formatBytes(stat.size)}`);
    console.log("");
  } catch (err) {
    console.error("\n=== SEA Build FAILED ===\n");
    console.error(err.message || err);
    console.error(
      "\nNote: esbuild may fail to bundle certain ESM-only dependencies",
    );
    console.error(
      "or native modules. Check the error above for details.\n",
    );
    process.exit(1);
  }
}

main();
